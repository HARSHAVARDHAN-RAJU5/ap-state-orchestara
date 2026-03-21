import sys
import os
sys.path.insert(0, os.path.dirname(__file__))

import redis
from dotenv import load_dotenv
from graph.builder import build_graph
from db import get_connection
from policy_engine import load_config

load_dotenv()

REDIS_URL = os.getenv("REDIS_URL", "redis://127.0.0.1:6379")

r = redis.from_url(REDIS_URL)

graph = build_graph()

def process_invoice(invoice_id: str, organization_id: str):

    conn = get_connection()
    cur = conn.cursor()
    cur.execute(
        "SELECT current_state, retry_count FROM invoice_state_machine WHERE invoice_id = %s AND organization_id = %s",
        (invoice_id, organization_id)
    )
    row = cur.fetchone()
    cur.close()
    conn.close()

    if not row:
        print(f"Invoice not found in DB: {invoice_id} — skipping")
        return

    current_state, retry_count = row

    # stop at terminal or human-in-the-loop states
    if current_state in ("COMPLETED", "BLOCKED", "WAITING_INFO", "PENDING_APPROVAL", "EXCEPTION_REVIEW"):
        print(f"Processing paused at: {current_state}")
        return

    # load org config
    try:
        config = load_config(organization_id)
    except Exception as e:
        print(f"Config load failed: {e}")
        return

    # build initial state for graph
    initial_state = {
        "invoice_id": invoice_id,
        "organization_id": organization_id,
        "current_state": current_state,
        "next_state": current_state,
        "reason": None,
        "retry_count": retry_count,
        "config": config
    }

    try:
        result = graph.invoke(initial_state)

        final_state = result.get("next_state")
        reason = result.get("reason")

        print(f"Invoice {invoice_id} processed. Final: {final_state} — {reason}")

        # update invoice_state_machine with final state
        if final_state and final_state != current_state:
            conn = get_connection()
            cur = conn.cursor()
            cur.execute(
                """
                UPDATE invoice_state_machine
                SET current_state = %s,
                    retry_count = 0,
                    last_updated = NOW()
                WHERE invoice_id = %s
                AND organization_id = %s
                """,
                (final_state, invoice_id, organization_id)
            )

            # write audit log
            cur.execute(
                """
                INSERT INTO audit_event_log
                    (invoice_id, organization_id, old_state, new_state, reason)
                VALUES (%s, %s, %s, %s, %s)
                """,
                (invoice_id, organization_id, current_state, final_state, reason)
            )

            conn.commit()
            cur.close()
            conn.close()

    except Exception as e:
        print(f"Graph execution failed for {invoice_id}: {e}")

        # increment retry count on failure
        conn = get_connection()
        cur = conn.cursor()
        cur.execute(
            """
            UPDATE invoice_state_machine
            SET retry_count = retry_count + 1,
                last_updated = NOW()
            WHERE invoice_id = %s
            AND organization_id = %s
            """,
            (invoice_id, organization_id)
        )
        conn.commit()
        cur.close()
        conn.close()

def listen():
    print("Python orchestrator running...")

    try:
        r.xgroup_create("invoice_events", "python_orchestrator", "0", mkstream=True)
    except Exception as e:
        if "BUSYGROUP" not in str(e):
            raise

    while True:
        try:
            messages = r.xreadgroup(
                "python_orchestrator",
                "python_worker_1",
                {"invoice_events": ">"},
                count=1,
                block=5000
            )

            if not messages:
                continue

            for stream, events in messages:
                for event_id, data in events:
                    invoice_id = data[b"invoice_id"].decode()
                    organization_id = data[b"organization_id"].decode()

                    print(f"Event received: {invoice_id}")

                    process_invoice(invoice_id, organization_id)

                    # always ack regardless of result
                    r.xack("invoice_events", "python_orchestrator", event_id)

        except Exception as e:
            print(f"Listener error: {e}")

if __name__ == "__main__":
    listen()