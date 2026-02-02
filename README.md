# Expense Categorization & Budget Analytics Backend

A TypeScript + PostgreSQL backend for automatic categorization of bank transactions with monthly spending analytics.

## Features

- **Automatic Transaction Categorization**: Rule-based keyword matching and statistical merchant-history analysis
- **Bulk Transaction Ingestion**: Import up to 1000 transactions per request with deduplication
- **Budget Tracking**: Set per-category spending limits with real-time utilization tracking
- **Spending Analytics**: Monthly summaries, category breakdowns, trends, and subscription detection
- **Materialized Views**: Pre-aggregated analytics data with concurrent refresh support
- **Optimized Queries**: Indexed lookups, trigram text search, lateral joins for budget aggregation

## Prerequisites

- Node.js >= 18
- PostgreSQL >= 14 (with `pg_trgm` extension)

## Setup

```bash
# Install dependencies
npm install

# Copy and configure environment
cp .env.example .env
# Edit .env with your PostgreSQL credentials

# Run database migrations
npm run migrate

# Start development server
npm run dev

# Build and start production
npm run build
npm start
```

## API Endpoints

### Transactions

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/transactions` | List transactions (filtered, paginated) |
| GET | `/api/transactions/:id` | Get single transaction |
| POST | `/api/transactions` | Create transaction (auto-categorized) |
| POST | `/api/transactions/bulk` | Bulk ingest transactions |
| PATCH | `/api/transactions/:id` | Update transaction |
| DELETE | `/api/transactions/:id` | Delete transaction |
| POST | `/api/transactions/:id/categorize` | Re-categorize a transaction |
| POST | `/api/transactions/categorize-uncategorized` | Batch categorize all uncategorized |

### Categories

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/categories` | List all categories |
| GET | `/api/categories/:id` | Get single category |
| POST | `/api/categories` | Create category |
| PATCH | `/api/categories/:id` | Update category |
| DELETE | `/api/categories/:id` | Delete category |

### Analytics

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/analytics/monthly` | Monthly spending summaries |
| GET | `/api/analytics/categories` | Spending breakdown by category |
| GET | `/api/analytics/trends` | Month-over-month spending trends |
| GET | `/api/analytics/daily` | Daily spending (for charts) |
| GET | `/api/analytics/subscriptions` | Detected recurring charges |
| GET | `/api/analytics/budgets` | Budget status overview |
| POST | `/api/analytics/budgets` | Create a budget |
| PATCH | `/api/analytics/budgets/:id` | Update a budget |
| DELETE | `/api/analytics/budgets/:id` | Delete a budget |
| POST | `/api/analytics/refresh` | Refresh materialized views |

## Query Parameters

### Transaction Listing

```
GET /api/transactions?user_id=1&from_date=2026-01-01&to_date=2026-03-31&category_id=1&min_amount=10&max_amount=500&search=grocery&page=1&limit=20&sort_by=transaction_date&sort_order=desc
```

### Analytics

```
GET /api/analytics/monthly?user_id=1&from_date=2025-01-01&to_date=2026-03-31
GET /api/analytics/trends?user_id=1&months=6
GET /api/analytics/daily?user_id=1&from_date=2026-03-01&to_date=2026-03-20
```

## Categorization Engine

The categorizer uses a three-tier strategy:

1. **Merchant History (Statistical)**: Looks up the merchant name against historically categorized transactions. Uses a materialized view tracking merchant-to-category mappings with confidence scores.

2. **Keyword Matching (Rule-based)**: Matches the transaction description and merchant name against each category's keyword list. Scores by hit count with a specificity bonus.

3. **Default Fallback**: Assigns "Other" category with low confidence when no match is found.

Categories ship with pre-configured keyword lists covering: Groceries, Rent, Utilities, Subscriptions, Dining, Transportation, Healthcare, Shopping, Entertainment, Income, and Transfers.

## Database Schema

Four core tables with optimized indexes:

- `users` — user accounts
- `transactions` — financial transactions with category assignments
- `categories` — hierarchical category tree with keyword arrays
- `budgets` — per-category spending limits with date ranges

Three materialized views for analytics:

- `mv_monthly_category_spending` — pre-aggregated monthly totals per category
- `mv_monthly_totals` — pre-aggregated monthly totals
- `mv_merchant_categories` — merchant-to-category statistical mappings

## Testing

```bash
npm test
```
