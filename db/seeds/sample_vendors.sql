-- SAMPLE DATA: fake vendors matching the sample contracts in data/contracts/.
-- VEN-001 already exists. safe to re-run.

INSERT INTO vendor_master (vendor_id, organization_id, legal_name, tax_id, bank_account, country_code, email, status)
VALUES
    ('VEN-002', 'ORG-1', 'Bharat Office Mart',          '27AABCB2345D1Z6', 'ICIC0002345678901', 'IN', 'accounts@bharatofficemart.example', 'ACTIVE'),
    ('VEN-003', 'ORG-1', 'Swift Logistics',             '07AACCS3456E1Z7', 'SBIN0003456789012', 'IN', 'billing@swiftlogistics.example',    'ACTIVE'),
    ('VEN-004', 'ORG-1', 'CloudNine Consulting',        '29AADCC4567F1Z8', 'UTIB0004567890123', 'IN', 'finance@cloudnine.example',         'ACTIVE'),
    ('VEN-005', 'ORG-1', 'GreenLeaf Facility Services', '33AAECG5678G1Z9', 'KKBK0005678901234', 'IN', 'invoices@greenleaf.example',        'ACTIVE')
ON CONFLICT (vendor_id) DO NOTHING;
