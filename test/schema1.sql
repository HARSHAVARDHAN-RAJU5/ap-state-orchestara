--
-- PostgreSQL database dump
--

\restrict UMbwvI22wUVMSHNEMqgiEphHwVPRnm9VOnbllONScwoTt0ZecAdRL5TidcD3ENf

-- Dumped from database version 15.15
-- Dumped by pg_dump version 15.15

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: account_mapping; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.account_mapping (
    organization_id text NOT NULL,
    expense_category text NOT NULL,
    expense_account_id integer NOT NULL,
    ap_account_id integer NOT NULL
);


ALTER TABLE public.account_mapping OWNER TO postgres;

--
-- Name: agent_action_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agent_action_log (
    id uuid DEFAULT gen_random_uuid() NOT NULL,
    invoice_id text NOT NULL,
    organization_id text NOT NULL,
    agent_name text NOT NULL,
    state_name text NOT NULL,
    action text NOT NULL,
    input jsonb,
    output jsonb,
    success boolean,
    error_message text,
    attempt_number integer DEFAULT 0,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.agent_action_log OWNER TO postgres;

--
-- Name: agent_reflection_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.agent_reflection_log (
    id integer NOT NULL,
    invoice_id text NOT NULL,
    organization_id text NOT NULL,
    state text NOT NULL,
    risk_score numeric,
    decision_summary text,
    override_state text,
    created_at timestamp without time zone DEFAULT now(),
    reflection jsonb
);


ALTER TABLE public.agent_reflection_log OWNER TO postgres;

--
-- Name: agent_reflection_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.agent_reflection_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.agent_reflection_log_id_seq OWNER TO postgres;

--
-- Name: agent_reflection_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.agent_reflection_log_id_seq OWNED BY public.agent_reflection_log.id;


--
-- Name: approval_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.approval_config (
    organization_id text NOT NULL,
    min_amount numeric NOT NULL,
    max_amount numeric NOT NULL,
    approver_role text NOT NULL
);


ALTER TABLE public.approval_config OWNER TO postgres;

--
-- Name: audit_event_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_event_log (
    id integer NOT NULL,
    invoice_id text NOT NULL,
    old_state text,
    new_state text,
    reason text,
    created_at timestamp without time zone DEFAULT now(),
    organization_id text NOT NULL
);


ALTER TABLE public.audit_event_log OWNER TO postgres;

--
-- Name: audit_event_log_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.audit_event_log_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.audit_event_log_id_seq OWNER TO postgres;

--
-- Name: audit_event_log_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.audit_event_log_id_seq OWNED BY public.audit_event_log.id;


--
-- Name: exception_review_decisions; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.exception_review_decisions (
    id integer NOT NULL,
    invoice_id text NOT NULL,
    decision text,
    reason text,
    processed boolean DEFAULT false,
    decided_at timestamp without time zone DEFAULT now(),
    organization_id text NOT NULL,
    reviewer_role text,
    reviewer_name text,
    review_cycle integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.exception_review_decisions OWNER TO postgres;

--
-- Name: exception_review_decisions_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.exception_review_decisions_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.exception_review_decisions_id_seq OWNER TO postgres;

--
-- Name: exception_review_decisions_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.exception_review_decisions_id_seq OWNED BY public.exception_review_decisions.id;


--
-- Name: failure_patterns; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.failure_patterns (
    id integer NOT NULL,
    organization_id text NOT NULL,
    vendor_id text NOT NULL,
    failure_type text NOT NULL,
    occurrence_count integer DEFAULT 1,
    last_occurrence timestamp without time zone DEFAULT now()
);


ALTER TABLE public.failure_patterns OWNER TO postgres;

--
-- Name: failure_patterns_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.failure_patterns_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.failure_patterns_id_seq OWNER TO postgres;

--
-- Name: failure_patterns_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.failure_patterns_id_seq OWNED BY public.failure_patterns.id;


--
-- Name: invoice_approval_workflow; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_approval_workflow (
    workflow_id integer NOT NULL,
    invoice_id text,
    assigned_to character varying(100),
    approval_level character varying(50),
    approval_status character varying(50) DEFAULT 'PENDING'::character varying,
    decision_at timestamp without time zone,
    comments text,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id text NOT NULL,
    escalated boolean DEFAULT false,
    required_approval_level text
);


ALTER TABLE public.invoice_approval_workflow OWNER TO postgres;

--
-- Name: invoice_approval_workflow_workflow_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_approval_workflow_workflow_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_approval_workflow_workflow_id_seq OWNER TO postgres;

--
-- Name: invoice_approval_workflow_workflow_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_approval_workflow_workflow_id_seq OWNED BY public.invoice_approval_workflow.workflow_id;


--
-- Name: invoice_compliance_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_compliance_results (
    invoice_id text NOT NULL,
    tax_compliance_status character varying(20),
    policy_compliance_status character varying(20),
    overall_compliance_status character varying(20),
    evaluated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id text NOT NULL,
    tax_status text,
    high_value_flag boolean DEFAULT false
);


ALTER TABLE public.invoice_compliance_results OWNER TO postgres;

--
-- Name: invoice_extracted_data; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_extracted_data (
    invoice_id text NOT NULL,
    data jsonb NOT NULL,
    extraction_status text NOT NULL,
    extracted_at timestamp without time zone DEFAULT now(),
    organization_id text NOT NULL
);


ALTER TABLE public.invoice_extracted_data OWNER TO postgres;

--
-- Name: invoice_fraud_scores; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_fraud_scores (
    invoice_id text NOT NULL,
    organization_id text NOT NULL,
    risk_score integer DEFAULT 0 NOT NULL,
    signals jsonb DEFAULT '[]'::jsonb NOT NULL,
    evaluated_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.invoice_fraud_scores OWNER TO postgres;

--
-- Name: invoice_payment_approvals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_payment_approvals (
    id integer NOT NULL,
    invoice_id text NOT NULL,
    organization_id text NOT NULL,
    decision text NOT NULL,
    reason text,
    reviewer_role text NOT NULL,
    reviewer_name text NOT NULL,
    decided_at timestamp with time zone DEFAULT now() NOT NULL,
    processed boolean DEFAULT false NOT NULL
);


ALTER TABLE public.invoice_payment_approvals OWNER TO postgres;

--
-- Name: invoice_payment_approvals_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_payment_approvals_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_payment_approvals_id_seq OWNER TO postgres;

--
-- Name: invoice_payment_approvals_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_payment_approvals_id_seq OWNED BY public.invoice_payment_approvals.id;


--
-- Name: invoice_payment_schedule; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_payment_schedule (
    payment_id integer NOT NULL,
    invoice_id text,
    payment_status character varying(50) DEFAULT 'SCHEDULED'::character varying,
    payment_due_date date,
    payment_method character varying(50),
    scheduled_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    paid_at timestamp without time zone,
    organization_id text NOT NULL
);


ALTER TABLE public.invoice_payment_schedule OWNER TO postgres;

--
-- Name: invoice_payment_schedule_payment_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.invoice_payment_schedule_payment_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.invoice_payment_schedule_payment_id_seq OWNER TO postgres;

--
-- Name: invoice_payment_schedule_payment_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.invoice_payment_schedule_payment_id_seq OWNED BY public.invoice_payment_schedule.payment_id;


--
-- Name: invoice_po_matching_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_po_matching_results (
    invoice_id text NOT NULL,
    po_number character varying(100),
    matching_status character varying(50),
    missing_po_flag boolean,
    price_variance_flag boolean,
    missing_receipt_flag boolean,
    matched_at timestamp without time zone DEFAULT now(),
    organization_id text NOT NULL,
    bank_mismatch_flag boolean DEFAULT false
);


ALTER TABLE public.invoice_po_matching_results OWNER TO postgres;

--
-- Name: invoice_risk_assessment; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_risk_assessment (
    invoice_id text NOT NULL,
    risk_level text,
    fraud_suspected boolean,
    reasoning text,
    recommended_action text,
    assessed_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    organization_id text NOT NULL,
    risk_score integer,
    classification text,
    reason text,
    evaluated_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.invoice_risk_assessment OWNER TO postgres;

--
-- Name: invoice_state_machine; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_state_machine (
    invoice_id text NOT NULL,
    current_state text NOT NULL,
    last_updated timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    error_reason text,
    retry_count integer DEFAULT 0,
    waiting_reason text,
    waiting_since timestamp without time zone,
    waiting_deadline timestamp without time zone,
    verification_token text,
    token_expiry timestamp without time zone,
    payment_retry_count integer DEFAULT 0 NOT NULL,
    organization_id text NOT NULL,
    last_sla_emitted_at timestamp with time zone,
    review_cycle integer DEFAULT 0 NOT NULL
);


ALTER TABLE public.invoice_state_machine OWNER TO postgres;

--
-- Name: invoice_validation_results; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoice_validation_results (
    invoice_id text NOT NULL,
    vendor_id text,
    legal_status character varying(50),
    tax_status character varying(50),
    bank_status character varying(50),
    overall_status character varying(50),
    validated_at timestamp without time zone DEFAULT now(),
    organization_id text NOT NULL
);


ALTER TABLE public.invoice_validation_results OWNER TO postgres;

--
-- Name: invoices; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.invoices (
    invoice_id text NOT NULL,
    source text NOT NULL,
    received_from text,
    original_filename text NOT NULL,
    file_path text NOT NULL,
    mime_type text,
    file_size_bytes bigint,
    status text NOT NULL,
    received_at timestamp without time zone NOT NULL,
    organization_id text NOT NULL
);


ALTER TABLE public.invoices OWNER TO postgres;

--
-- Name: journal_entries; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.journal_entries (
    journal_id integer NOT NULL,
    organization_id text NOT NULL,
    invoice_id text NOT NULL,
    entry_type text NOT NULL,
    status text NOT NULL,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.journal_entries OWNER TO postgres;

--
-- Name: journal_entries_journal_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.journal_entries_journal_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.journal_entries_journal_id_seq OWNER TO postgres;

--
-- Name: journal_entries_journal_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.journal_entries_journal_id_seq OWNED BY public.journal_entries.journal_id;


--
-- Name: journal_lines; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.journal_lines (
    line_id integer NOT NULL,
    journal_id integer,
    account_id integer NOT NULL,
    debit_amount numeric DEFAULT 0,
    credit_amount numeric DEFAULT 0
);


ALTER TABLE public.journal_lines OWNER TO postgres;

--
-- Name: journal_lines_line_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.journal_lines_line_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.journal_lines_line_id_seq OWNER TO postgres;

--
-- Name: journal_lines_line_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.journal_lines_line_id_seq OWNED BY public.journal_lines.line_id;


--
-- Name: matching_tolerance_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.matching_tolerance_config (
    organization_id text NOT NULL,
    price_variance_percentage numeric NOT NULL,
    quantity_variance_percent numeric NOT NULL,
    allow_partial_receipt boolean NOT NULL
);


ALTER TABLE public.matching_tolerance_config OWNER TO postgres;

--
-- Name: organizations; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.organizations (
    id text NOT NULL,
    name text NOT NULL,
    base_currency text,
    timezone text,
    created_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.organizations OWNER TO postgres;

--
-- Name: paid_invoice_registry; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.paid_invoice_registry (
    id integer NOT NULL,
    invoice_id text NOT NULL,
    organization_id text NOT NULL,
    invoice_number text NOT NULL,
    vendor_name text NOT NULL,
    total_amount numeric,
    paid_at timestamp without time zone DEFAULT now()
);


ALTER TABLE public.paid_invoice_registry OWNER TO postgres;

--
-- Name: paid_invoice_registry_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.paid_invoice_registry_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.paid_invoice_registry_id_seq OWNER TO postgres;

--
-- Name: paid_invoice_registry_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.paid_invoice_registry_id_seq OWNED BY public.paid_invoice_registry.id;


--
-- Name: payment_policy_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.payment_policy_config (
    organization_id text NOT NULL,
    auto_schedule boolean NOT NULL,
    early_payment_discount_threshold numeric,
    max_payment_delay_days integer NOT NULL,
    default_due_days integer DEFAULT 30 NOT NULL,
    max_retry_count integer DEFAULT 2 NOT NULL,
    default_payment_method text DEFAULT 'BANK_TRANSFER'::text NOT NULL
);


ALTER TABLE public.payment_policy_config OWNER TO postgres;

--
-- Name: purchase_orders; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.purchase_orders (
    po_id text NOT NULL,
    po_number character varying(100) NOT NULL,
    vendor_id text,
    total_amount numeric,
    created_at timestamp without time zone DEFAULT now(),
    organization_id text,
    status text DEFAULT 'OPEN'::text
);


ALTER TABLE public.purchase_orders OWNER TO postgres;

--
-- Name: purchase_orders_po_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.purchase_orders_po_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.purchase_orders_po_id_seq OWNER TO postgres;

--
-- Name: purchase_orders_po_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.purchase_orders_po_id_seq OWNED BY public.purchase_orders.po_id;


--
-- Name: sla_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sla_config (
    organization_id text NOT NULL,
    state_name text NOT NULL,
    sla_days integer NOT NULL,
    escalation_level text,
    is_active boolean DEFAULT true,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.sla_config OWNER TO postgres;

--
-- Name: tax_rules_config; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tax_rules_config (
    organization_id text NOT NULL,
    vat_enabled boolean NOT NULL,
    vat_validation_strict boolean NOT NULL,
    country_code text NOT NULL
);


ALTER TABLE public.tax_rules_config OWNER TO postgres;

--
-- Name: tax_rules_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.tax_rules_master (
    id integer NOT NULL,
    country_code character varying(5) NOT NULL,
    tax_type character varying(20) NOT NULL,
    expected_rate numeric(5,4) NOT NULL,
    effective_from date NOT NULL,
    effective_to date,
    created_at timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.tax_rules_master OWNER TO postgres;

--
-- Name: tax_rules_master_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.tax_rules_master_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.tax_rules_master_id_seq OWNER TO postgres;

--
-- Name: tax_rules_master_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.tax_rules_master_id_seq OWNED BY public.tax_rules_master.id;


--
-- Name: vendor_master; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.vendor_master (
    vendor_id text NOT NULL,
    legal_name character varying(255) NOT NULL,
    tax_id character varying(100) NOT NULL,
    bank_account character varying(100) NOT NULL,
    status character varying(50) DEFAULT 'ACTIVE'::character varying,
    created_at timestamp without time zone DEFAULT now(),
    updated_at timestamp without time zone DEFAULT now(),
    country_code character varying(5),
    email text,
    organization_id text
);


ALTER TABLE public.vendor_master OWNER TO postgres;

--
-- Name: vendor_master_vendor_id_seq; Type: SEQUENCE; Schema: public; Owner: postgres
--

CREATE SEQUENCE public.vendor_master_vendor_id_seq
    AS integer
    START WITH 1
    INCREMENT BY 1
    NO MINVALUE
    NO MAXVALUE
    CACHE 1;


ALTER TABLE public.vendor_master_vendor_id_seq OWNER TO postgres;

--
-- Name: vendor_master_vendor_id_seq; Type: SEQUENCE OWNED BY; Schema: public; Owner: postgres
--

ALTER SEQUENCE public.vendor_master_vendor_id_seq OWNED BY public.vendor_master.vendor_id;


--
-- Name: worker_completion_log; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.worker_completion_log (
    invoice_id text NOT NULL,
    organization_id text NOT NULL,
    state text NOT NULL,
    completed_at timestamp with time zone DEFAULT now() NOT NULL
);


ALTER TABLE public.worker_completion_log OWNER TO postgres;

--
-- Name: agent_reflection_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_reflection_log ALTER COLUMN id SET DEFAULT nextval('public.agent_reflection_log_id_seq'::regclass);


--
-- Name: audit_event_log id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_event_log ALTER COLUMN id SET DEFAULT nextval('public.audit_event_log_id_seq'::regclass);


--
-- Name: exception_review_decisions id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exception_review_decisions ALTER COLUMN id SET DEFAULT nextval('public.exception_review_decisions_id_seq'::regclass);


--
-- Name: failure_patterns id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.failure_patterns ALTER COLUMN id SET DEFAULT nextval('public.failure_patterns_id_seq'::regclass);


--
-- Name: invoice_approval_workflow workflow_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_approval_workflow ALTER COLUMN workflow_id SET DEFAULT nextval('public.invoice_approval_workflow_workflow_id_seq'::regclass);


--
-- Name: invoice_payment_approvals id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_approvals ALTER COLUMN id SET DEFAULT nextval('public.invoice_payment_approvals_id_seq'::regclass);


--
-- Name: invoice_payment_schedule payment_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_schedule ALTER COLUMN payment_id SET DEFAULT nextval('public.invoice_payment_schedule_payment_id_seq'::regclass);


--
-- Name: journal_entries journal_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries ALTER COLUMN journal_id SET DEFAULT nextval('public.journal_entries_journal_id_seq'::regclass);


--
-- Name: journal_lines line_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_lines ALTER COLUMN line_id SET DEFAULT nextval('public.journal_lines_line_id_seq'::regclass);


--
-- Name: paid_invoice_registry id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paid_invoice_registry ALTER COLUMN id SET DEFAULT nextval('public.paid_invoice_registry_id_seq'::regclass);


--
-- Name: tax_rules_master id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rules_master ALTER COLUMN id SET DEFAULT nextval('public.tax_rules_master_id_seq'::regclass);


--
-- Name: vendor_master vendor_id; Type: DEFAULT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_master ALTER COLUMN vendor_id SET DEFAULT nextval('public.vendor_master_vendor_id_seq'::regclass);


--
-- Name: account_mapping account_mapping_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.account_mapping
    ADD CONSTRAINT account_mapping_pkey PRIMARY KEY (organization_id, expense_category);


--
-- Name: agent_action_log agent_action_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_action_log
    ADD CONSTRAINT agent_action_log_pkey PRIMARY KEY (id);


--
-- Name: agent_reflection_log agent_reflection_log_invoice_org_state_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_reflection_log
    ADD CONSTRAINT agent_reflection_log_invoice_org_state_unique UNIQUE (invoice_id, organization_id, state);


--
-- Name: agent_reflection_log agent_reflection_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.agent_reflection_log
    ADD CONSTRAINT agent_reflection_log_pkey PRIMARY KEY (id);


--
-- Name: approval_config approval_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.approval_config
    ADD CONSTRAINT approval_config_pkey PRIMARY KEY (organization_id, min_amount, max_amount);


--
-- Name: invoice_approval_workflow approval_unique_invoice_org; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_approval_workflow
    ADD CONSTRAINT approval_unique_invoice_org UNIQUE (invoice_id, organization_id);


--
-- Name: audit_event_log audit_event_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_event_log
    ADD CONSTRAINT audit_event_log_pkey PRIMARY KEY (id);


--
-- Name: exception_review_decisions exception_review_decisions_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exception_review_decisions
    ADD CONSTRAINT exception_review_decisions_pkey PRIMARY KEY (id);


--
-- Name: failure_patterns failure_patterns_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.failure_patterns
    ADD CONSTRAINT failure_patterns_pkey PRIMARY KEY (id);


--
-- Name: invoice_approval_workflow invoice_approval_workflow_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_approval_workflow
    ADD CONSTRAINT invoice_approval_workflow_pkey PRIMARY KEY (workflow_id);


--
-- Name: invoice_compliance_results invoice_compliance_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_compliance_results
    ADD CONSTRAINT invoice_compliance_results_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoice_extracted_data invoice_extracted_data_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_extracted_data
    ADD CONSTRAINT invoice_extracted_data_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoice_fraud_scores invoice_fraud_scores_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_fraud_scores
    ADD CONSTRAINT invoice_fraud_scores_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoice_payment_approvals invoice_payment_approvals_invoice_org_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_approvals
    ADD CONSTRAINT invoice_payment_approvals_invoice_org_unique UNIQUE (invoice_id, organization_id);


--
-- Name: invoice_payment_approvals invoice_payment_approvals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_approvals
    ADD CONSTRAINT invoice_payment_approvals_pkey PRIMARY KEY (id);


--
-- Name: invoice_payment_schedule invoice_payment_schedule_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_schedule
    ADD CONSTRAINT invoice_payment_schedule_pkey PRIMARY KEY (payment_id);


--
-- Name: invoice_payment_schedule invoice_payment_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_schedule
    ADD CONSTRAINT invoice_payment_unique UNIQUE (invoice_id, organization_id);


--
-- Name: invoice_po_matching_results invoice_po_matching_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_po_matching_results
    ADD CONSTRAINT invoice_po_matching_results_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoice_risk_assessment invoice_risk_assessment_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_risk_assessment
    ADD CONSTRAINT invoice_risk_assessment_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoice_state_machine invoice_state_machine_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_state_machine
    ADD CONSTRAINT invoice_state_machine_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoice_validation_results invoice_validation_results_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_validation_results
    ADD CONSTRAINT invoice_validation_results_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: invoices invoices_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_pkey PRIMARY KEY (invoice_id, organization_id);


--
-- Name: journal_entries journal_entries_invoice_org_type_unique; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_invoice_org_type_unique UNIQUE (invoice_id, organization_id, entry_type);


--
-- Name: journal_entries journal_entries_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_entries
    ADD CONSTRAINT journal_entries_pkey PRIMARY KEY (journal_id);


--
-- Name: journal_lines journal_lines_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_pkey PRIMARY KEY (line_id);


--
-- Name: matching_tolerance_config matching_tolerance_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matching_tolerance_config
    ADD CONSTRAINT matching_tolerance_config_pkey PRIMARY KEY (organization_id);


--
-- Name: organizations organizations_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.organizations
    ADD CONSTRAINT organizations_pkey PRIMARY KEY (id);


--
-- Name: paid_invoice_registry paid_invoice_registry_organization_id_invoice_number_vendor_key; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paid_invoice_registry
    ADD CONSTRAINT paid_invoice_registry_organization_id_invoice_number_vendor_key UNIQUE (organization_id, invoice_number, vendor_name);


--
-- Name: paid_invoice_registry paid_invoice_registry_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.paid_invoice_registry
    ADD CONSTRAINT paid_invoice_registry_pkey PRIMARY KEY (id);


--
-- Name: payment_policy_config payment_policy_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_policy_config
    ADD CONSTRAINT payment_policy_config_pkey PRIMARY KEY (organization_id);


--
-- Name: purchase_orders purchase_orders_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_pkey PRIMARY KEY (po_id);


--
-- Name: sla_config sla_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sla_config
    ADD CONSTRAINT sla_config_pkey PRIMARY KEY (organization_id, state_name);


--
-- Name: tax_rules_config tax_rules_config_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rules_config
    ADD CONSTRAINT tax_rules_config_pkey PRIMARY KEY (organization_id);


--
-- Name: tax_rules_master tax_rules_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rules_master
    ADD CONSTRAINT tax_rules_master_pkey PRIMARY KEY (id);


--
-- Name: vendor_master vendor_master_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.vendor_master
    ADD CONSTRAINT vendor_master_pkey PRIMARY KEY (vendor_id);


--
-- Name: worker_completion_log worker_completion_log_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.worker_completion_log
    ADD CONSTRAINT worker_completion_log_pkey PRIMARY KEY (invoice_id, organization_id, state);


--
-- Name: idx_agent_action_log_errors; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_agent_action_log_errors ON public.agent_action_log USING btree (invoice_id, organization_id, state_name, action) WHERE ((action = 'ERROR'::text) AND (success = false));


--
-- Name: idx_invoice_approval_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_approval_org ON public.invoice_approval_workflow USING btree (invoice_id, organization_id);


--
-- Name: idx_invoice_payment_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_invoice_payment_org ON public.invoice_payment_schedule USING btree (invoice_id, organization_id);


--
-- Name: idx_payment_approvals_invoice; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_payment_approvals_invoice ON public.invoice_payment_approvals USING btree (invoice_id, organization_id, processed);


--
-- Name: idx_state_machine_state_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_state_machine_state_org ON public.invoice_state_machine USING btree (current_state, organization_id);


--
-- Name: idx_vendor_email; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX idx_vendor_email ON public.vendor_master USING btree (email);


--
-- Name: po_number_per_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX po_number_per_org ON public.purchase_orders USING btree (organization_id, po_number);


--
-- Name: vendor_tax_id_per_org; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX vendor_tax_id_per_org ON public.vendor_master USING btree (organization_id, tax_id);


--
-- Name: approval_config approval_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.approval_config
    ADD CONSTRAINT approval_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: audit_event_log audit_event_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_event_log
    ADD CONSTRAINT audit_event_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: exception_review_decisions exception_review_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.exception_review_decisions
    ADD CONSTRAINT exception_review_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_approval_workflow invoice_approval_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_approval_workflow
    ADD CONSTRAINT invoice_approval_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_compliance_results invoice_compliance_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_compliance_results
    ADD CONSTRAINT invoice_compliance_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_payment_schedule invoice_payment_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_payment_schedule
    ADD CONSTRAINT invoice_payment_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_po_matching_results invoice_po_matching_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_po_matching_results
    ADD CONSTRAINT invoice_po_matching_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_risk_assessment invoice_risk_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_risk_assessment
    ADD CONSTRAINT invoice_risk_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_state_machine invoice_state_machine_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_state_machine
    ADD CONSTRAINT invoice_state_machine_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_validation_results invoice_validation_invoice_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_validation_results
    ADD CONSTRAINT invoice_validation_invoice_fk FOREIGN KEY (invoice_id, organization_id) REFERENCES public.invoices(invoice_id, organization_id);


--
-- Name: invoice_validation_results invoice_validation_results_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoice_validation_results
    ADD CONSTRAINT invoice_validation_results_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_master(vendor_id);


--
-- Name: invoices invoices_org_fk; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.invoices
    ADD CONSTRAINT invoices_org_fk FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: journal_lines journal_lines_journal_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.journal_lines
    ADD CONSTRAINT journal_lines_journal_id_fkey FOREIGN KEY (journal_id) REFERENCES public.journal_entries(journal_id);


--
-- Name: matching_tolerance_config matching_tolerance_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.matching_tolerance_config
    ADD CONSTRAINT matching_tolerance_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: payment_policy_config payment_policy_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.payment_policy_config
    ADD CONSTRAINT payment_policy_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- Name: purchase_orders purchase_orders_vendor_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.purchase_orders
    ADD CONSTRAINT purchase_orders_vendor_id_fkey FOREIGN KEY (vendor_id) REFERENCES public.vendor_master(vendor_id);


--
-- Name: tax_rules_config tax_rules_config_organization_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.tax_rules_config
    ADD CONSTRAINT tax_rules_config_organization_id_fkey FOREIGN KEY (organization_id) REFERENCES public.organizations(id);


--
-- PostgreSQL database dump complete
--

\unrestrict UMbwvI22wUVMSHNEMqgiEphHwVPRnm9VOnbllONScwoTt0ZecAdRL5TidcD3ENf

