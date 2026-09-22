from graph.state import InvoiceState
from workers.intake_worker import run as intake_run
from workers.duplicate_worker import run as duplicate_run
from workers.validation_worker import run as validation_run
from workers.matching_worker import run as matching_run
from workers.fraud_worker import run as fraud_run
from workers.compliance_worker import run as compliance_run
from workers.payment_worker import run as payment_run
from workers.accounting_worker import run as accounting_run
from workers.pending_approval_worker import run as pending_approval_run
from workers.exception_review_worker import run as exception_review_run

def intake_node(state: InvoiceState) -> InvoiceState:
    return intake_run(state)

def duplicate_node(state: InvoiceState) -> InvoiceState:
    return duplicate_run(state)

def validation_node(state: InvoiceState) -> InvoiceState:
    return validation_run(state)

def matching_node(state: InvoiceState) -> InvoiceState:
    return matching_run(state)

def fraud_node(state: InvoiceState) -> InvoiceState:
    return fraud_run(state)

def compliance_node(state: InvoiceState) -> InvoiceState:
    return compliance_run(state)

def payment_node(state: InvoiceState) -> InvoiceState:
    return payment_run(state)

def pending_approval_node(state: InvoiceState) -> InvoiceState:
    return pending_approval_run(state)

def exception_review_node(state: InvoiceState) -> InvoiceState:
    return exception_review_run(state)

def accounting_node(state: InvoiceState) -> InvoiceState:
    return accounting_run(state)