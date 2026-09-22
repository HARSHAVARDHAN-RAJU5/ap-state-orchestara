from langgraph.graph import StateGraph, END
from graph.state import InvoiceState

from graph.nodes import (
    intake_node, duplicate_node, validation_node,
    matching_node, fraud_node, compliance_node,
    payment_node, pending_approval_node,
    exception_review_node, accounting_node
)

# reaching one of these mid-run means wait for a human / vendor, or we're done
STOP_STATES = {"PENDING_APPROVAL", "EXCEPTION_REVIEW", "WAITING_INFO", "COMPLETED", "BLOCKED"}

def route_entry(state: InvoiceState) -> str:
    # router always runs the node for the state the invoice is currently in
    return state.get("next_state") or END

def route(state: InvoiceState) -> str:
    next_state = state.get("next_state")
    # None = worker error, same state = no progress (e.g. payment not due yet)
    if not next_state or next_state == state.get("current_state"):
        return END
    if next_state in STOP_STATES:
        return END
    return next_state

def router_node(state: InvoiceState) -> InvoiceState:
    return state

def step(name, fn):
    # stamps the node name as current_state and records the hop for the audit log
    def wrapped(state: InvoiceState) -> InvoiceState:
        result = fn({**state, "current_state": name})
        next_state = result.get("next_state")
        history = list(state.get("history") or [])
        if next_state and next_state != name:
            history.append({"from": name, "to": next_state, "reason": result.get("reason")})
        return {**result, "current_state": name, "history": history}
    return wrapped

def build_graph():
    graph = StateGraph(InvoiceState)

    # entry router — jumps to correct node based on current state
    graph.add_node("ROUTER", router_node)

    nodes = {
        "RECEIVED": intake_node,
        "STRUCTURED": lambda state: {**state, "next_state": "DUPLICATE_CHECK", "reason": "Structured data ready"},
        "DUPLICATE_CHECK": duplicate_node,
        "VALIDATING": validation_node,
        "MATCHING": matching_node,
        "FRAUD_SCREENING": fraud_node,
        "COMPLIANCE": compliance_node,
        "PAYMENT_READY": payment_node,
        "PENDING_APPROVAL": pending_approval_node,
        "EXCEPTION_REVIEW": exception_review_node,
        "ACCOUNTING": accounting_node,
    }

    for name, fn in nodes.items():
        graph.add_node(name, step(name, fn))

    # start at router always
    graph.set_entry_point("ROUTER")

    # router decides which node to jump to
    graph.add_conditional_edges("ROUTER", route_entry)

    # every node routes to next via route function
    for name in nodes:
        graph.add_conditional_edges(name, route)

    return graph.compile()
