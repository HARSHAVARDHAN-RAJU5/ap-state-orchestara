from langgraph.graph import StateGraph, END
from graph.state import InvoiceState

from graph.nodes import (
    intake_node, duplicate_node, validation_node,
    matching_node, fraud_node, compliance_node,
    payment_node, pending_approval_node,
    exception_review_node, accounting_node
)

def route(state: InvoiceState) -> str:
    next_state = state.get("next_state")
    if not next_state:
        return END
    return next_state

def router_node(state: InvoiceState) -> InvoiceState:
    return state

def build_graph():
    graph = StateGraph(InvoiceState)

    # entry router — jumps to correct node based on current state
    graph.add_node("ROUTER", router_node)

    graph.add_node("RECEIVED", intake_node)
    graph.add_node("STRUCTURED", lambda state: {**state, "next_state": "DUPLICATE_CHECK"})
    graph.add_node("DUPLICATE_CHECK", duplicate_node)
    graph.add_node("VALIDATING", validation_node)
    graph.add_node("MATCHING", matching_node)
    graph.add_node("FRAUD_SCREENING", fraud_node)
    graph.add_node("COMPLIANCE", compliance_node)
    graph.add_node("PAYMENT_READY", payment_node)
    graph.add_node("PENDING_APPROVAL", pending_approval_node)
    graph.add_node("EXCEPTION_REVIEW", exception_review_node)
    graph.add_node("ACCOUNTING", accounting_node)

    # start at router always
    graph.set_entry_point("ROUTER")

    # router decides which node to jump to
    graph.add_conditional_edges("ROUTER", route)

    # every node routes to next via route function
    for node in [
        "RECEIVED", "STRUCTURED", "DUPLICATE_CHECK", "VALIDATING",
        "MATCHING", "FRAUD_SCREENING", "COMPLIANCE",
        "PAYMENT_READY", "PENDING_APPROVAL",
        "EXCEPTION_REVIEW", "ACCOUNTING"
    ]:
        graph.add_conditional_edges(node, route)

    return graph.compile()