<!-- 8f537c5f-4f87-473a-bc21-57adab2ac2cf 34368b48-9f68-4fa8-97f3-1e84245fdf36 -->
# Add INSERT, UPDATE, and DELETE Support

## Overview

Extend the SQL-to-REST translator to support INSERT (POST), UPDATE (PATCH), and DELETE operations with basic RETURNING support and simple filtering.

## Implementation Steps

### 1. Update Type Definitions

**File: `src/processor/types.ts`**

Add three new statement types alongside the existing `Select` type:

```typescript
export type Statement = Select | Insert | Update | Delete

export type Insert = {
  type: 'insert'
  into: string
  columns: string[]
  values: (string | number | boolean | null)[][]
  returning?: string[]  // basic RETURNING support
}

export type Update = {
  type: 'update'
  table: string
  set: Record<string, string | number | boolean | null>
  filter?: Filter  // reuse existing Filter type
  returning?: string[]
}

export type Delete = {
  type: 'delete'
  from: string
  filter?: Filter
  returning?: string[]
}
```

### 2. Create Statement Processors

**File: `src/processor/insert.ts` (new file)**

Create `processInsertStatement()` function that:

- Extracts table name from `InsertStmt.relation.relname`
- Parses column names from `InsertStmt.cols`
- Processes values from `InsertStmt.selectStmt.SelectStmt.valuesLists`
- Handles RETURNING clause if present (basic columns only)
- Throws `UnsupportedError` for unsupported features (subqueries, ON CONFLICT)

**File: `src/processor/update.ts` (new file)**

Create `processUpdateStatement()` function that:

- Extracts table name from `UpdateStmt.relation.relname`
- Processes SET clause from `UpdateStmt.targetList`
- Reuses `processWhereClause()` for filtering with basic operators only
- Handles RETURNING clause (basic columns only)
- Validates filters use only: eq, neq, gt, gte, lt, lte

**File: `src/processor/delete.ts` (new file)**

Create `processDeleteStatement()` function that:

- Extracts table name from `DeleteStmt.relation.relname`
- Reuses `processWhereClause()` for filtering with basic operators only
- Handles RETURNING clause (basic columns only)
- Validates filters use only: eq, neq, gt, gte, lt, lte

### 3. Wire Up Processors

**File: `src/processor/index.ts`**

Update `processStatement()` to call new processors instead of throwing `UnimplementedError`:

```typescript
if ('InsertStmt' in stmt) {
  return processInsertStatement(stmt)
} else if ('UpdateStmt' in stmt) {
  return processUpdateStatement(stmt)
} else if ('DeleteStmt' in stmt) {
  return processDeleteStatement(stmt)
}
```

Export new processors and types.

### 4. Update HTTP Renderer

**File: `src/renderers/http.ts`**

Add rendering functions:

- `formatInsert()`: Returns `{ method: 'POST', path: '/table', body: {...}, params: {...} }` with optional `select` param for RETURNING
- `formatUpdate()`: Returns `{ method: 'PATCH', path: '/table', body: {...}, params: {...} }` with filters and optional RETURNING
- `formatDelete()`: Returns `{ method: 'DELETE', path: '/table', params: {...} }` with filters and optional RETURNING

Update `HttpRequest` type to include `body?: object` and support methods 'POST' | 'PATCH' | 'DELETE'.

Update `formatCurl()` and `formatHttp()` to handle POST/PATCH/DELETE with request bodies.

### 5. Update Supabase-JS Renderer

**File: `src/renderers/supabase-js.ts`**

Add rendering functions:

- `formatInsert()`: Generates `.from('table').insert([{...}]).select()` code
- `formatUpdate()`: Generates `.from('table').update({...}).eq(...).select()` code  
- `formatDelete()`: Generates `.from('table').delete().eq(...).select()` code

Update `renderSupabaseJs()` to route to appropriate formatter based on statement type.

### 6. Add Tests

**File: `src/renderers/http.test.ts`**

Add test suites for:

- INSERT: single row, multiple rows, with/without RETURNING
- UPDATE: with filters (eq, gt, lt, etc.), with/without RETURNING
- DELETE: with filters, with/without RETURNING

**File: `src/renderers/supabase-js.test.ts`**

Add corresponding test suites for supabase-js code generation.

### 7. Update Documentation

**File: `README.md`**

Update the roadmap section to mark INSERT, UPDATE, and DELETE as completed with notes about supported features and limitations.

## Key Design Decisions

- Reuse existing `Filter` type and `processWhereClause()` for UPDATE/DELETE filtering
- Validate filters in UPDATE/DELETE to only allow basic operators (eq, neq, gt, gte, lt, lte)
- Support basic RETURNING with column names only (no aggregates, joins, or expressions)
- Leverage PostgREST's query parameter approach for filters on UPDATE/DELETE
- No support for INSERT...ON CONFLICT (upsert) in this phase

### To-dos

- [ ] Add Insert, Update, Delete statement types to src/processor/types.ts
- [ ] Create src/processor/insert.ts with processInsertStatement()
- [ ] Create src/processor/update.ts with processUpdateStatement()
- [ ] Create src/processor/delete.ts with processDeleteStatement()
- [ ] Update src/processor/index.ts to call new processors
- [ ] Add INSERT/UPDATE/DELETE rendering to src/renderers/http.ts
- [ ] Add INSERT/UPDATE/DELETE rendering to src/renderers/supabase-js.ts
- [ ] Add test cases for INSERT/UPDATE/DELETE in src/renderers/http.test.ts
- [ ] Add test cases for INSERT/UPDATE/DELETE in src/renderers/supabase-js.test.ts
- [ ] Update README.md roadmap to mark features as completed