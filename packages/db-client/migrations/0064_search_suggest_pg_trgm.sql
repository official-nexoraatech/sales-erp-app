-- Smart Search "did you mean": trigram similarity between a query and this tenant's own
-- historical queries (search_analytics.query), used by GET /search/suggest in search-service.
-- No new service dependency — pg_trgm ships with standard PostgreSQL.
CREATE EXTENSION IF NOT EXISTS pg_trgm;
