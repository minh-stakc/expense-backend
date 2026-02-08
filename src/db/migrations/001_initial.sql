-- 001_initial.sql
-- Core tables for expense tracking with proper indexes

BEGIN;

-- ─── Enable trigram extension (needed for text search index) ─────────

CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- ─── Users ───────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS users (
    id          SERIAL PRIMARY KEY,
    email       VARCHAR(255) NOT NULL UNIQUE,
    name        VARCHAR(255) NOT NULL,
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW(),
    updated_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_users_email ON users (email);

-- ─── Categories ──────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS categories (
    id          SERIAL PRIMARY KEY,
    name        VARCHAR(100) NOT NULL,
    slug        VARCHAR(100) NOT NULL UNIQUE,
    parent_id   INTEGER      REFERENCES categories(id) ON DELETE SET NULL,
    keywords    TEXT[]       NOT NULL DEFAULT '{}',
    icon        VARCHAR(50),
    created_at  TIMESTAMPTZ  NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_categories_slug ON categories (slug);
CREATE INDEX idx_categories_parent ON categories (parent_id) WHERE parent_id IS NOT NULL;
CREATE INDEX idx_categories_keywords ON categories USING GIN (keywords);

-- Seed default categories
INSERT INTO categories (name, slug, keywords, icon) VALUES
    ('Groceries',       'groceries',      ARRAY['grocery','supermarket','whole foods','trader joe','kroger','safeway','aldi','walmart grocery','costco','publix','heb','food lion','wegmans','sprouts','market'], 'cart'),
    ('Rent & Mortgage', 'rent',           ARRAY['rent','mortgage','lease','landlord','property management','apartment'], 'home'),
    ('Utilities',       'utilities',      ARRAY['electric','electricity','gas','water','sewer','utility','power','energy','pge','con edison','duke energy','national grid'], 'zap'),
    ('Subscriptions',   'subscriptions',  ARRAY['netflix','spotify','hulu','disney','hbo','apple music','youtube premium','amazon prime','subscription','membership','recurring'], 'repeat'),
    ('Dining Out',      'dining',         ARRAY['restaurant','cafe','coffee','starbucks','mcdonald','burger','pizza','doordash','ubereats','grubhub','chipotle','subway','wendy','taco bell'], 'utensils'),
    ('Transportation',  'transportation', ARRAY['gas station','fuel','uber','lyft','taxi','transit','metro','bus','parking','toll','shell','chevron','exxon','bp'], 'car'),
    ('Healthcare',      'healthcare',     ARRAY['pharmacy','doctor','hospital','medical','dental','vision','cvs','walgreens','health','clinic','urgent care','insurance premium'], 'heart'),
    ('Shopping',        'shopping',       ARRAY['amazon','target','walmart','ebay','best buy','clothing','apparel','shoes','electronics','online shopping','store'], 'shopping-bag'),
    ('Entertainment',   'entertainment',  ARRAY['movie','theater','concert','game','sports','ticket','amusement','museum','bowling','arcade'], 'film'),
    ('Income',          'income',         ARRAY['payroll','salary','deposit','direct deposit','interest','dividend','refund','cashback','reimbursement'], 'dollar-sign'),
    ('Transfer',        'transfer',       ARRAY['transfer','zelle','venmo','paypal','wire','ach'], 'arrows-right-left'),
    ('Other',           'other',          ARRAY[]::TEXT[], 'help-circle')
ON CONFLICT (slug) DO NOTHING;

-- ─── Transactions ────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS transactions (
    id                      SERIAL PRIMARY KEY,
    user_id                 INTEGER        NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    external_id             VARCHAR(255),
    amount                  NUMERIC(12,2)  NOT NULL,
    currency                VARCHAR(3)     NOT NULL DEFAULT 'USD',
    description             VARCHAR(500)   NOT NULL,
    merchant_name           VARCHAR(255),
    category_id             INTEGER        REFERENCES categories(id) ON DELETE SET NULL,
    category_confidence     NUMERIC(4,3),
    is_manually_categorized BOOLEAN        NOT NULL DEFAULT FALSE,
    transaction_date        DATE           NOT NULL,
    posted_date             DATE,
    account_name            VARCHAR(255),
    created_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),
    updated_at              TIMESTAMPTZ    NOT NULL DEFAULT NOW(),

    CONSTRAINT uq_user_external_id UNIQUE (user_id, external_id)
);

-- Primary lookup patterns
CREATE INDEX idx_txn_user_date ON transactions (user_id, transaction_date DESC);
CREATE INDEX idx_txn_user_category ON transactions (user_id, category_id);
CREATE INDEX idx_txn_user_amount ON transactions (user_id, amount);
CREATE INDEX idx_txn_date ON transactions (transaction_date DESC);

-- Full-text search on description and merchant
CREATE INDEX idx_txn_description_trgm ON transactions USING GIN (
    (lower(description) || ' ' || COALESCE(lower(merchant_name), '')) gin_trgm_ops
);

-- Partial index for uncategorized transactions (categorizer queue)
CREATE INDEX idx_txn_uncategorized ON transactions (user_id, created_at)
    WHERE category_id IS NULL;

-- Composite for monthly aggregation queries
CREATE INDEX idx_txn_user_cat_date ON transactions (user_id, category_id, transaction_date);

-- ─── Budgets ─────────────────────────────────────────────────────────

CREATE TABLE IF NOT EXISTS budgets (
    id            SERIAL PRIMARY KEY,
    user_id       INTEGER       NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    category_id   INTEGER       NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    amount_limit  NUMERIC(12,2) NOT NULL CHECK (amount_limit > 0),
    period_type   VARCHAR(10)   NOT NULL CHECK (period_type IN ('monthly','weekly','yearly')),
    period_start  DATE          NOT NULL,
    period_end    DATE          NOT NULL,
    created_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),
    updated_at    TIMESTAMPTZ   NOT NULL DEFAULT NOW(),

    CONSTRAINT chk_budget_period CHECK (period_end > period_start),
    CONSTRAINT uq_user_cat_period UNIQUE (user_id, category_id, period_type, period_start)
);

CREATE INDEX idx_budgets_user_period ON budgets (user_id, period_start, period_end);
CREATE INDEX idx_budgets_user_category ON budgets (user_id, category_id);

-- ─── Updated-at trigger ──────────────────────────────────────────────

CREATE OR REPLACE FUNCTION update_updated_at_column()
RETURNS TRIGGER AS $$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$$ LANGUAGE plpgsql;

CREATE TRIGGER trg_users_updated_at
    BEFORE UPDATE ON users
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_transactions_updated_at
    BEFORE UPDATE ON transactions
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

CREATE TRIGGER trg_budgets_updated_at
    BEFORE UPDATE ON budgets
    FOR EACH ROW EXECUTE FUNCTION update_updated_at_column();

COMMIT;
