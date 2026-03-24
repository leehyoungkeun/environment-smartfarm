--
-- PostgreSQL database dump
--

\restrict n7N7QcFrxO2EakVXRamHcorqG2NwHj8i7u4Cdiv8a7tJz8YTHhQm59fugZQeBk5

-- Dumped from database version 17.7
-- Dumped by pg_dump version 17.7

SET statement_timeout = 0;
SET lock_timeout = 0;
SET idle_in_transaction_session_timeout = 0;
SET transaction_timeout = 0;
SET client_encoding = 'UTF8';
SET standard_conforming_strings = on;
SELECT pg_catalog.set_config('search_path', '', false);
SET check_function_bodies = false;
SET xmloption = content;
SET client_min_messages = warning;
SET row_security = off;

--
-- Name: public; Type: SCHEMA; Schema: -; Owner: postgres
--

-- *not* creating schema, since initdb creates it


ALTER SCHEMA public OWNER TO postgres;

--
-- Name: SCHEMA public; Type: COMMENT; Schema: -; Owner: postgres
--

COMMENT ON SCHEMA public IS '';


--
-- Name: timescaledb; Type: EXTENSION; Schema: -; Owner: -
--

CREATE EXTENSION IF NOT EXISTS timescaledb WITH SCHEMA public;


--
-- Name: EXTENSION timescaledb; Type: COMMENT; Schema: -; Owner: 
--

COMMENT ON EXTENSION timescaledb IS 'Enables scalable inserts and complex queries for time-series data (Community Edition)';


SET default_tablespace = '';

SET default_table_access_method = heap;

--
-- Name: _compressed_hypertable_2; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._compressed_hypertable_2 (
);


ALTER TABLE _timescaledb_internal._compressed_hypertable_2 OWNER TO postgres;

--
-- Name: _compressed_hypertable_4; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._compressed_hypertable_4 (
);


ALTER TABLE _timescaledb_internal._compressed_hypertable_4 OWNER TO postgres;

--
-- Name: sensor_data; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.sensor_data (
    "timestamp" timestamp(6) with time zone NOT NULL,
    farm_id text NOT NULL,
    house_id text NOT NULL,
    data jsonb DEFAULT '{}'::jsonb NOT NULL,
    metadata jsonb DEFAULT '{}'::jsonb
);


ALTER TABLE public.sensor_data OWNER TO postgres;

--
-- Name: _hyper_1_1_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_1_1_chunk (
    CONSTRAINT constraint_1 CHECK ((("timestamp" >= '2026-02-26 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-03-05 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.sensor_data);


ALTER TABLE _timescaledb_internal._hyper_1_1_chunk OWNER TO postgres;

--
-- Name: _hyper_1_4_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_1_4_chunk (
    CONSTRAINT constraint_4 CHECK ((("timestamp" >= '2026-03-05 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-03-12 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.sensor_data);


ALTER TABLE _timescaledb_internal._hyper_1_4_chunk OWNER TO postgres;

--
-- Name: _hyper_1_7_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_1_7_chunk (
    CONSTRAINT constraint_7 CHECK ((("timestamp" >= '2026-03-12 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-03-19 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.sensor_data);


ALTER TABLE _timescaledb_internal._hyper_1_7_chunk OWNER TO postgres;

--
-- Name: control_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.control_logs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "timestamp" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    farm_id text NOT NULL,
    house_id text NOT NULL,
    control_house_id text,
    device_id text NOT NULL,
    device_type text DEFAULT 'unknown'::text,
    device_name text,
    command text NOT NULL,
    success boolean DEFAULT true NOT NULL,
    error text,
    request_id text,
    operator text DEFAULT 'web_dashboard'::text,
    operator_name text,
    lambda_response jsonb,
    is_automatic boolean DEFAULT false,
    automation_rule_id text,
    automation_reason text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.control_logs OWNER TO postgres;

--
-- Name: _hyper_3_2_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_3_2_chunk (
    CONSTRAINT constraint_2 CHECK ((("timestamp" >= '2026-02-06 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-03-08 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.control_logs);


ALTER TABLE _timescaledb_internal._hyper_3_2_chunk OWNER TO postgres;

--
-- Name: _hyper_3_5_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_3_5_chunk (
    CONSTRAINT constraint_5 CHECK ((("timestamp" >= '2026-03-08 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-04-07 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.control_logs);


ALTER TABLE _timescaledb_internal._hyper_3_5_chunk OWNER TO postgres;

--
-- Name: alerts; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.alerts (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    "timestamp" timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    farm_id text NOT NULL,
    house_id text NOT NULL,
    sensor_id text,
    alert_type text NOT NULL,
    severity text DEFAULT 'WARNING'::text,
    message text,
    value double precision,
    threshold double precision,
    metadata jsonb DEFAULT '{}'::jsonb,
    acknowledged boolean DEFAULT false,
    acknowledged_at timestamp(6) with time zone
);


ALTER TABLE public.alerts OWNER TO postgres;

--
-- Name: _hyper_5_3_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_5_3_chunk (
    CONSTRAINT constraint_3 CHECK ((("timestamp" >= '2026-02-06 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-03-08 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.alerts);


ALTER TABLE _timescaledb_internal._hyper_5_3_chunk OWNER TO postgres;

--
-- Name: _hyper_5_6_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal._hyper_5_6_chunk (
    CONSTRAINT constraint_6 CHECK ((("timestamp" >= '2026-03-08 09:00:00+09'::timestamp with time zone) AND ("timestamp" < '2026-04-07 09:00:00+09'::timestamp with time zone)))
)
INHERITS (public.alerts);


ALTER TABLE _timescaledb_internal._hyper_5_6_chunk OWNER TO postgres;

--
-- Name: compress_hyper_2_8_chunk; Type: TABLE; Schema: _timescaledb_internal; Owner: postgres
--

CREATE TABLE _timescaledb_internal.compress_hyper_2_8_chunk (
    _ts_meta_count integer,
    farm_id text,
    house_id text,
    _ts_meta_min_1 timestamp(6) with time zone,
    _ts_meta_max_1 timestamp(6) with time zone,
    "timestamp" _timescaledb_internal.compressed_data,
    data _timescaledb_internal.compressed_data,
    metadata _timescaledb_internal.compressed_data
)
WITH (toast_tuple_target='128');
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN _ts_meta_count SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN farm_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN house_id SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN _ts_meta_min_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN _ts_meta_max_1 SET STATISTICS 1000;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN "timestamp" SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN data SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN data SET STORAGE EXTENDED;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN metadata SET STATISTICS 0;
ALTER TABLE ONLY _timescaledb_internal.compress_hyper_2_8_chunk ALTER COLUMN metadata SET STORAGE EXTENDED;


ALTER TABLE _timescaledb_internal.compress_hyper_2_8_chunk OWNER TO postgres;

--
-- Name: audit_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.audit_logs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    farm_id text,
    user_id text,
    user_name text,
    action text NOT NULL,
    target_type text NOT NULL,
    target_id text,
    details jsonb DEFAULT '{}'::jsonb,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.audit_logs OWNER TO postgres;

--
-- Name: automation_rules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.automation_rules (
    id text NOT NULL,
    farm_id text NOT NULL,
    house_id text,
    name text NOT NULL,
    description text DEFAULT ''::text NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    condition_logic text DEFAULT 'AND'::text NOT NULL,
    conditions jsonb NOT NULL,
    actions jsonb NOT NULL,
    cooldown_seconds integer DEFAULT 300 NOT NULL,
    last_triggered_at timestamp(3) without time zone,
    trigger_count integer DEFAULT 0 NOT NULL,
    priority integer DEFAULT 10 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    group_logic text DEFAULT 'AND'::text NOT NULL
);


ALTER TABLE public.automation_rules OWNER TO postgres;

--
-- Name: business_projects; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.business_projects (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    name text NOT NULL,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.business_projects OWNER TO postgres;

--
-- Name: farm_documents; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.farm_documents (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    farm_id text NOT NULL,
    file_name text NOT NULL,
    original_name text NOT NULL,
    file_path text NOT NULL,
    file_size integer DEFAULT 0 NOT NULL,
    mime_type text,
    category text DEFAULT 'other'::text NOT NULL,
    description text,
    uploaded_by text,
    uploader_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.farm_documents OWNER TO postgres;

--
-- Name: farm_journals; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.farm_journals (
    id text NOT NULL,
    farm_id text NOT NULL,
    house_id text,
    date date NOT NULL,
    weather text,
    temp_min double precision,
    temp_max double precision,
    humidity double precision,
    work_type text NOT NULL,
    growth_stage text,
    content text NOT NULL,
    pest text,
    notes text,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.farm_journals OWNER TO postgres;

--
-- Name: farm_notes; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.farm_notes (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    farm_id text NOT NULL,
    content text NOT NULL,
    author text,
    author_id text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP
);


ALTER TABLE public.farm_notes OWNER TO postgres;

--
-- Name: farm_schedules; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.farm_schedules (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    farm_id text NOT NULL,
    title text NOT NULL,
    description text,
    type text DEFAULT 'general'::text NOT NULL,
    start_date date NOT NULL,
    end_date date,
    all_day boolean DEFAULT true NOT NULL,
    completed boolean DEFAULT false NOT NULL,
    completed_at timestamp(6) with time zone,
    assigned_to text,
    house_id text,
    priority text DEFAULT 'normal'::text NOT NULL,
    color text,
    recurrence jsonb,
    created_by text,
    created_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.farm_schedules OWNER TO postgres;

--
-- Name: farms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.farms (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    farm_id text NOT NULL,
    name text NOT NULL,
    location text,
    owner_name text,
    owner_phone text,
    api_key text NOT NULL,
    status text DEFAULT 'active'::text,
    last_seen_at timestamp(6) with time zone,
    memo text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    managers jsonb DEFAULT '[]'::jsonb,
    registered_at date DEFAULT CURRENT_DATE,
    maintenance_months integer DEFAULT 12,
    maintenance_start_at date DEFAULT CURRENT_DATE,
    system_type text,
    farm_type text,
    farm_area text,
    tags text[] DEFAULT ARRAY[]::text[],
    deleted_at timestamp(6) with time zone,
    business_project_id text,
    total_cost bigint,
    subsidy_amount bigint,
    self_funding bigint,
    business_type text
);


ALTER TABLE public.farms OWNER TO postgres;

--
-- Name: harvest_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.harvest_records (
    id text NOT NULL,
    farm_id text NOT NULL,
    house_id text,
    date date NOT NULL,
    crop_name text NOT NULL,
    quantity double precision NOT NULL,
    unit text DEFAULT 'kg'::text NOT NULL,
    grade text,
    destination text,
    unit_price double precision,
    total_revenue double precision,
    notes text,
    photos jsonb DEFAULT '[]'::jsonb NOT NULL,
    created_by text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.harvest_records OWNER TO postgres;

--
-- Name: house_configs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.house_configs (
    id text NOT NULL,
    farm_id text NOT NULL,
    house_id text NOT NULL,
    house_name text DEFAULT ''::text NOT NULL,
    sensors jsonb DEFAULT '[]'::jsonb NOT NULL,
    collection jsonb DEFAULT '{}'::jsonb NOT NULL,
    devices jsonb DEFAULT '[]'::jsonb NOT NULL,
    device_count integer DEFAULT 0 NOT NULL,
    enabled boolean DEFAULT true NOT NULL,
    config_version integer DEFAULT 1 NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL,
    crops jsonb DEFAULT '[]'::jsonb NOT NULL,
    crop_type text DEFAULT ''::text NOT NULL,
    crop_variety text DEFAULT ''::text NOT NULL,
    planting_date text DEFAULT ''::text NOT NULL
);


ALTER TABLE public.house_configs OWNER TO postgres;

--
-- Name: input_records; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.input_records (
    id text NOT NULL,
    farm_id text NOT NULL,
    house_id text,
    date date NOT NULL,
    input_type text NOT NULL,
    product_name text NOT NULL,
    manufacturer text,
    quantity double precision NOT NULL,
    unit text NOT NULL,
    cost double precision,
    target_area double precision,
    method text,
    notes text,
    created_by text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.input_records OWNER TO postgres;

--
-- Name: maintenance_logs; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.maintenance_logs (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    farm_id text NOT NULL,
    date date NOT NULL,
    type text NOT NULL,
    title text NOT NULL,
    description text,
    cost integer,
    technician text,
    status text DEFAULT 'completed'::text NOT NULL,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.maintenance_logs OWNER TO postgres;

--
-- Name: system_settings; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.system_settings (
    farm_id text NOT NULL,
    settings jsonb DEFAULT '{}'::jsonb NOT NULL,
    updated_at timestamp(6) with time zone DEFAULT CURRENT_TIMESTAMP NOT NULL
);


ALTER TABLE public.system_settings OWNER TO postgres;

--
-- Name: user_farms; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.user_farms (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    user_id text NOT NULL,
    farm_id text NOT NULL,
    role text DEFAULT 'viewer'::text,
    permissions jsonb DEFAULT '{}'::jsonb NOT NULL
);


ALTER TABLE public.user_farms OWNER TO postgres;

--
-- Name: users; Type: TABLE; Schema: public; Owner: postgres
--

CREATE TABLE public.users (
    id text DEFAULT (gen_random_uuid())::text NOT NULL,
    username text NOT NULL,
    password text NOT NULL,
    name text NOT NULL,
    role text DEFAULT 'worker'::text NOT NULL,
    farm_id text DEFAULT 'farm_0001'::text NOT NULL,
    allowed_houses text[] DEFAULT ARRAY[]::text[],
    enabled boolean DEFAULT true NOT NULL,
    last_login_at timestamp(3) without time zone,
    refresh_token text,
    created_at timestamp(3) without time zone DEFAULT CURRENT_TIMESTAMP NOT NULL,
    updated_at timestamp(3) without time zone NOT NULL
);


ALTER TABLE public.users OWNER TO postgres;

--
-- Name: _hyper_1_1_chunk data; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_1_chunk ALTER COLUMN data SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_1_1_chunk metadata; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_1_chunk ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_1_4_chunk data; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_4_chunk ALTER COLUMN data SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_1_4_chunk metadata; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_4_chunk ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_1_7_chunk data; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_7_chunk ALTER COLUMN data SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_1_7_chunk metadata; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_7_chunk ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_3_2_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;


--
-- Name: _hyper_3_2_chunk timestamp; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;


--
-- Name: _hyper_3_2_chunk device_type; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN device_type SET DEFAULT 'unknown'::text;


--
-- Name: _hyper_3_2_chunk success; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN success SET DEFAULT true;


--
-- Name: _hyper_3_2_chunk operator; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN operator SET DEFAULT 'web_dashboard'::text;


--
-- Name: _hyper_3_2_chunk is_automatic; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN is_automatic SET DEFAULT false;


--
-- Name: _hyper_3_2_chunk created_at; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;


--
-- Name: _hyper_3_5_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;


--
-- Name: _hyper_3_5_chunk timestamp; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;


--
-- Name: _hyper_3_5_chunk device_type; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN device_type SET DEFAULT 'unknown'::text;


--
-- Name: _hyper_3_5_chunk success; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN success SET DEFAULT true;


--
-- Name: _hyper_3_5_chunk operator; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN operator SET DEFAULT 'web_dashboard'::text;


--
-- Name: _hyper_3_5_chunk is_automatic; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN is_automatic SET DEFAULT false;


--
-- Name: _hyper_3_5_chunk created_at; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk ALTER COLUMN created_at SET DEFAULT CURRENT_TIMESTAMP;


--
-- Name: _hyper_5_3_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_3_chunk ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;


--
-- Name: _hyper_5_3_chunk timestamp; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_3_chunk ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;


--
-- Name: _hyper_5_3_chunk severity; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_3_chunk ALTER COLUMN severity SET DEFAULT 'WARNING'::text;


--
-- Name: _hyper_5_3_chunk metadata; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_3_chunk ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_5_3_chunk acknowledged; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_3_chunk ALTER COLUMN acknowledged SET DEFAULT false;


--
-- Name: _hyper_5_6_chunk id; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_6_chunk ALTER COLUMN id SET DEFAULT (gen_random_uuid())::text;


--
-- Name: _hyper_5_6_chunk timestamp; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_6_chunk ALTER COLUMN "timestamp" SET DEFAULT CURRENT_TIMESTAMP;


--
-- Name: _hyper_5_6_chunk severity; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_6_chunk ALTER COLUMN severity SET DEFAULT 'WARNING'::text;


--
-- Name: _hyper_5_6_chunk metadata; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_6_chunk ALTER COLUMN metadata SET DEFAULT '{}'::jsonb;


--
-- Name: _hyper_5_6_chunk acknowledged; Type: DEFAULT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_6_chunk ALTER COLUMN acknowledged SET DEFAULT false;


--
-- Name: _hyper_1_1_chunk 1_1_sensor_data_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_1_chunk
    ADD CONSTRAINT "1_1_sensor_data_pkey" PRIMARY KEY ("timestamp", farm_id, house_id);


--
-- Name: _hyper_3_2_chunk 2_2_control_logs_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_2_chunk
    ADD CONSTRAINT "2_2_control_logs_pkey" PRIMARY KEY ("timestamp", id);


--
-- Name: _hyper_5_3_chunk 3_3_alerts_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_3_chunk
    ADD CONSTRAINT "3_3_alerts_pkey" PRIMARY KEY ("timestamp", id);


--
-- Name: _hyper_1_4_chunk 4_4_sensor_data_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_4_chunk
    ADD CONSTRAINT "4_4_sensor_data_pkey" PRIMARY KEY ("timestamp", farm_id, house_id);


--
-- Name: _hyper_3_5_chunk 5_5_control_logs_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_3_5_chunk
    ADD CONSTRAINT "5_5_control_logs_pkey" PRIMARY KEY ("timestamp", id);


--
-- Name: _hyper_5_6_chunk 6_6_alerts_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_5_6_chunk
    ADD CONSTRAINT "6_6_alerts_pkey" PRIMARY KEY ("timestamp", id);


--
-- Name: _hyper_1_7_chunk 7_7_sensor_data_pkey; Type: CONSTRAINT; Schema: _timescaledb_internal; Owner: postgres
--

ALTER TABLE ONLY _timescaledb_internal._hyper_1_7_chunk
    ADD CONSTRAINT "7_7_sensor_data_pkey" PRIMARY KEY ("timestamp", farm_id, house_id);


--
-- Name: alerts alerts_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.alerts
    ADD CONSTRAINT alerts_pkey PRIMARY KEY ("timestamp", id);


--
-- Name: audit_logs audit_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.audit_logs
    ADD CONSTRAINT audit_logs_pkey PRIMARY KEY (id);


--
-- Name: automation_rules automation_rules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.automation_rules
    ADD CONSTRAINT automation_rules_pkey PRIMARY KEY (id);


--
-- Name: business_projects business_projects_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.business_projects
    ADD CONSTRAINT business_projects_pkey PRIMARY KEY (id);


--
-- Name: control_logs control_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.control_logs
    ADD CONSTRAINT control_logs_pkey PRIMARY KEY ("timestamp", id);


--
-- Name: farm_documents farm_documents_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_documents
    ADD CONSTRAINT farm_documents_pkey PRIMARY KEY (id);


--
-- Name: farm_journals farm_journals_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_journals
    ADD CONSTRAINT farm_journals_pkey PRIMARY KEY (id);


--
-- Name: farm_notes farm_notes_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_notes
    ADD CONSTRAINT farm_notes_pkey PRIMARY KEY (id);


--
-- Name: farm_schedules farm_schedules_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_schedules
    ADD CONSTRAINT farm_schedules_pkey PRIMARY KEY (id);


--
-- Name: farms farms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farms
    ADD CONSTRAINT farms_pkey PRIMARY KEY (id);


--
-- Name: harvest_records harvest_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.harvest_records
    ADD CONSTRAINT harvest_records_pkey PRIMARY KEY (id);


--
-- Name: house_configs house_configs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.house_configs
    ADD CONSTRAINT house_configs_pkey PRIMARY KEY (id);


--
-- Name: input_records input_records_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.input_records
    ADD CONSTRAINT input_records_pkey PRIMARY KEY (id);


--
-- Name: maintenance_logs maintenance_logs_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_pkey PRIMARY KEY (id);


--
-- Name: sensor_data sensor_data_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.sensor_data
    ADD CONSTRAINT sensor_data_pkey PRIMARY KEY ("timestamp", farm_id, house_id);


--
-- Name: system_settings system_settings_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.system_settings
    ADD CONSTRAINT system_settings_pkey PRIMARY KEY (farm_id);


--
-- Name: user_farms user_farms_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_farms
    ADD CONSTRAINT user_farms_pkey PRIMARY KEY (id);


--
-- Name: users users_pkey; Type: CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.users
    ADD CONSTRAINT users_pkey PRIMARY KEY (id);


--
-- Name: _hyper_1_1_chunk_idx_sensor_data_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_1_1_chunk_idx_sensor_data_farm_house ON _timescaledb_internal._hyper_1_1_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: _hyper_1_1_chunk_sensor_data_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_1_1_chunk_sensor_data_timestamp_idx ON _timescaledb_internal._hyper_1_1_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_1_4_chunk_idx_sensor_data_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_1_4_chunk_idx_sensor_data_farm_house ON _timescaledb_internal._hyper_1_4_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: _hyper_1_4_chunk_sensor_data_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_1_4_chunk_sensor_data_timestamp_idx ON _timescaledb_internal._hyper_1_4_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_1_7_chunk_idx_sensor_data_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_1_7_chunk_idx_sensor_data_farm_house ON _timescaledb_internal._hyper_1_7_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: _hyper_1_7_chunk_sensor_data_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_1_7_chunk_sensor_data_timestamp_idx ON _timescaledb_internal._hyper_1_7_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_3_2_chunk_control_logs_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_2_chunk_control_logs_timestamp_idx ON _timescaledb_internal._hyper_3_2_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_3_2_chunk_idx_control_logs_farm_device; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_2_chunk_idx_control_logs_farm_device ON _timescaledb_internal._hyper_3_2_chunk USING btree (farm_id, device_id, "timestamp" DESC);


--
-- Name: _hyper_3_2_chunk_idx_control_logs_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_2_chunk_idx_control_logs_farm_house ON _timescaledb_internal._hyper_3_2_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: _hyper_3_2_chunk_idx_control_logs_request_id; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_2_chunk_idx_control_logs_request_id ON _timescaledb_internal._hyper_3_2_chunk USING btree (request_id);


--
-- Name: _hyper_3_5_chunk_control_logs_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_5_chunk_control_logs_timestamp_idx ON _timescaledb_internal._hyper_3_5_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_3_5_chunk_idx_control_logs_farm_device; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_5_chunk_idx_control_logs_farm_device ON _timescaledb_internal._hyper_3_5_chunk USING btree (farm_id, device_id, "timestamp" DESC);


--
-- Name: _hyper_3_5_chunk_idx_control_logs_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_5_chunk_idx_control_logs_farm_house ON _timescaledb_internal._hyper_3_5_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: _hyper_3_5_chunk_idx_control_logs_request_id; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_3_5_chunk_idx_control_logs_request_id ON _timescaledb_internal._hyper_3_5_chunk USING btree (request_id);


--
-- Name: _hyper_5_3_chunk_alerts_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_5_3_chunk_alerts_timestamp_idx ON _timescaledb_internal._hyper_5_3_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_5_3_chunk_idx_alerts_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_5_3_chunk_idx_alerts_farm_house ON _timescaledb_internal._hyper_5_3_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: _hyper_5_6_chunk_alerts_timestamp_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_5_6_chunk_alerts_timestamp_idx ON _timescaledb_internal._hyper_5_6_chunk USING btree ("timestamp" DESC);


--
-- Name: _hyper_5_6_chunk_idx_alerts_farm_house; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX _hyper_5_6_chunk_idx_alerts_farm_house ON _timescaledb_internal._hyper_5_6_chunk USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: compress_hyper_2_8_chunk_farm_id_house_id__ts_meta_min_1__t_idx; Type: INDEX; Schema: _timescaledb_internal; Owner: postgres
--

CREATE INDEX compress_hyper_2_8_chunk_farm_id_house_id__ts_meta_min_1__t_idx ON _timescaledb_internal.compress_hyper_2_8_chunk USING btree (farm_id, house_id, _ts_meta_min_1 DESC, _ts_meta_max_1 DESC);


--
-- Name: alerts_timestamp_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX alerts_timestamp_idx ON public.alerts USING btree ("timestamp" DESC);


--
-- Name: automation_rules_farm_id_house_id_enabled_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX automation_rules_farm_id_house_id_enabled_idx ON public.automation_rules USING btree (farm_id, house_id, enabled);


--
-- Name: business_projects_name_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX business_projects_name_key ON public.business_projects USING btree (name);


--
-- Name: control_logs_timestamp_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX control_logs_timestamp_idx ON public.control_logs USING btree ("timestamp" DESC);


--
-- Name: farm_journals_farm_id_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX farm_journals_farm_id_date_idx ON public.farm_journals USING btree (farm_id, date);


--
-- Name: farm_journals_farm_id_house_id_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX farm_journals_farm_id_house_id_date_idx ON public.farm_journals USING btree (farm_id, house_id, date);


--
-- Name: farms_api_key_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX farms_api_key_key ON public.farms USING btree (api_key);


--
-- Name: farms_farm_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX farms_farm_id_key ON public.farms USING btree (farm_id);


--
-- Name: harvest_records_farm_id_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX harvest_records_farm_id_date_idx ON public.harvest_records USING btree (farm_id, date);


--
-- Name: house_configs_farm_id_house_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX house_configs_farm_id_house_id_key ON public.house_configs USING btree (farm_id, house_id);


--
-- Name: idx_alerts_farm_house; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_alerts_farm_house ON public.alerts USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: idx_audit_logs_farm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_farm ON public.audit_logs USING btree (farm_id, created_at DESC);


--
-- Name: idx_audit_logs_time; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_audit_logs_time ON public.audit_logs USING btree (created_at DESC);


--
-- Name: idx_control_logs_farm_device; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_control_logs_farm_device ON public.control_logs USING btree (farm_id, device_id, "timestamp" DESC);


--
-- Name: idx_control_logs_farm_house; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_control_logs_farm_house ON public.control_logs USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: idx_control_logs_request_id; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_control_logs_request_id ON public.control_logs USING btree (request_id);


--
-- Name: idx_farm_documents_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_farm_documents_created ON public.farm_documents USING btree (farm_id, created_at DESC);


--
-- Name: idx_farm_documents_farm; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_farm_documents_farm ON public.farm_documents USING btree (farm_id, category);


--
-- Name: idx_farm_notes_farm_created; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_farm_notes_farm_created ON public.farm_notes USING btree (farm_id, created_at DESC);


--
-- Name: idx_farm_schedules_completed; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_farm_schedules_completed ON public.farm_schedules USING btree (farm_id, completed, start_date);


--
-- Name: idx_farm_schedules_farm_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_farm_schedules_farm_date ON public.farm_schedules USING btree (farm_id, start_date);


--
-- Name: idx_maintenance_logs_farm_date; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_maintenance_logs_farm_date ON public.maintenance_logs USING btree (farm_id, date);


--
-- Name: idx_sensor_data_farm_house; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX idx_sensor_data_farm_house ON public.sensor_data USING btree (farm_id, house_id, "timestamp" DESC);


--
-- Name: input_records_farm_id_date_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX input_records_farm_id_date_idx ON public.input_records USING btree (farm_id, date);


--
-- Name: sensor_data_timestamp_idx; Type: INDEX; Schema: public; Owner: postgres
--

CREATE INDEX sensor_data_timestamp_idx ON public.sensor_data USING btree ("timestamp" DESC);


--
-- Name: user_farms_user_id_farm_id_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX user_farms_user_id_farm_id_key ON public.user_farms USING btree (user_id, farm_id);


--
-- Name: users_username_key; Type: INDEX; Schema: public; Owner: postgres
--

CREATE UNIQUE INDEX users_username_key ON public.users USING btree (username);


--
-- Name: farm_documents farm_documents_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_documents
    ADD CONSTRAINT farm_documents_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms(id) ON DELETE CASCADE;


--
-- Name: farm_notes farm_notes_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_notes
    ADD CONSTRAINT farm_notes_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms(id) ON DELETE CASCADE;


--
-- Name: farm_schedules farm_schedules_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farm_schedules
    ADD CONSTRAINT farm_schedules_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms(id) ON DELETE CASCADE;


--
-- Name: farms farms_business_project_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.farms
    ADD CONSTRAINT farms_business_project_id_fkey FOREIGN KEY (business_project_id) REFERENCES public.business_projects(id) ON DELETE SET NULL;


--
-- Name: maintenance_logs maintenance_logs_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.maintenance_logs
    ADD CONSTRAINT maintenance_logs_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms(id) ON DELETE CASCADE;


--
-- Name: user_farms user_farms_farm_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_farms
    ADD CONSTRAINT user_farms_farm_id_fkey FOREIGN KEY (farm_id) REFERENCES public.farms(id) ON DELETE CASCADE;


--
-- Name: user_farms user_farms_user_id_fkey; Type: FK CONSTRAINT; Schema: public; Owner: postgres
--

ALTER TABLE ONLY public.user_farms
    ADD CONSTRAINT user_farms_user_id_fkey FOREIGN KEY (user_id) REFERENCES public.users(id) ON DELETE CASCADE;


--
-- Name: SCHEMA public; Type: ACL; Schema: -; Owner: postgres
--

REVOKE USAGE ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO smartfarm;


--
-- Name: TABLE _compressed_hypertable_2; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._compressed_hypertable_2 TO smartfarm;


--
-- Name: TABLE _compressed_hypertable_4; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._compressed_hypertable_4 TO smartfarm;


--
-- Name: TABLE sensor_data; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.sensor_data TO smartfarm;


--
-- Name: TABLE _hyper_1_1_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_1_1_chunk TO smartfarm;


--
-- Name: TABLE _hyper_1_4_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_1_4_chunk TO smartfarm;


--
-- Name: TABLE _hyper_1_7_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_1_7_chunk TO smartfarm;


--
-- Name: TABLE control_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.control_logs TO smartfarm;


--
-- Name: TABLE _hyper_3_2_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_3_2_chunk TO smartfarm;


--
-- Name: TABLE _hyper_3_5_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_3_5_chunk TO smartfarm;


--
-- Name: TABLE alerts; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.alerts TO smartfarm;


--
-- Name: TABLE _hyper_5_3_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_5_3_chunk TO smartfarm;


--
-- Name: TABLE _hyper_5_6_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal._hyper_5_6_chunk TO smartfarm;


--
-- Name: TABLE compress_hyper_2_8_chunk; Type: ACL; Schema: _timescaledb_internal; Owner: postgres
--

GRANT ALL ON TABLE _timescaledb_internal.compress_hyper_2_8_chunk TO smartfarm;


--
-- Name: TABLE audit_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.audit_logs TO smartfarm;


--
-- Name: TABLE automation_rules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.automation_rules TO smartfarm;


--
-- Name: TABLE business_projects; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.business_projects TO smartfarm;


--
-- Name: TABLE farm_documents; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.farm_documents TO smartfarm;


--
-- Name: TABLE farm_journals; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.farm_journals TO smartfarm;


--
-- Name: TABLE farm_notes; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.farm_notes TO smartfarm;


--
-- Name: TABLE farm_schedules; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.farm_schedules TO smartfarm;


--
-- Name: TABLE farms; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.farms TO smartfarm;


--
-- Name: TABLE harvest_records; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.harvest_records TO smartfarm;


--
-- Name: TABLE house_configs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.house_configs TO smartfarm;


--
-- Name: TABLE input_records; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.input_records TO smartfarm;


--
-- Name: TABLE maintenance_logs; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.maintenance_logs TO smartfarm;


--
-- Name: TABLE system_settings; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.system_settings TO smartfarm;


--
-- Name: TABLE user_farms; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.user_farms TO smartfarm;


--
-- Name: TABLE users; Type: ACL; Schema: public; Owner: postgres
--

GRANT ALL ON TABLE public.users TO smartfarm;


--
-- PostgreSQL database dump complete
--

\unrestrict n7N7QcFrxO2EakVXRamHcorqG2NwHj8i7u4Cdiv8a7tJz8YTHhQm59fugZQeBk5

