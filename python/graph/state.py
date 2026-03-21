from typing import Optional
from typing_extensions import TypedDict

class InvoiceState(TypedDict):
    invoice_id: str
    organization_id: str
    current_state: str
    next_state: Optional[str]
    reason: Optional[str]
    retry_count: int
    config: Optional[dict]