export type Statement = Select

export type Select = {
  type: 'select'
  from: string
  targets: Target[]
  filter?: Filter
  sorts?: Sort[]
  limit?: Limit
}

export type Limit = {
  count?: number
  offset?: number
}

export type LogicalOperator = 'and' | 'or'

export type BaseFilter = {
  negate: boolean
}

export type BaseColumnFilter = BaseFilter & {
  type: 'column'
  column: string
}

export type EqColumnFilter = BaseColumnFilter & {
  operator: 'eq'
  value: string | number
}

export type NeqColumnFilter = BaseColumnFilter & {
  operator: 'neq'
  value: string | number
}

export type GtColumnFilter = BaseColumnFilter & {
  operator: 'gt'
  value: string | number
}

export type GteColumnFilter = BaseColumnFilter & {
  operator: 'gte'
  value: string | number
}

export type LtColumnFilter = BaseColumnFilter & {
  operator: 'lt'
  value: string | number
}

export type LteColumnFilter = BaseColumnFilter & {
  operator: 'lte'
  value: string | number
}

export type LikeColumnFilter = BaseColumnFilter & {
  operator: 'like'
  value: string
}

export type IlikeColumnFilter = BaseColumnFilter & {
  operator: 'ilike'
  value: string
}

export type MatchColumnFilter = BaseColumnFilter & {
  operator: 'match'
  value: string
}

export type ImatchColumnFilter = BaseColumnFilter & {
  operator: 'imatch'
  value: string
}

export type IsColumnFilter = BaseColumnFilter & {
  operator: 'is'
  value: null
}

export type InColumnFilter = BaseColumnFilter & {
  operator: 'in'
  value: (string | number)[]
}

export type FtsColumnFilter = BaseColumnFilter & {
  operator: 'fts'
  config?: string
  value: string
}

export type PlainFtsColumnFilter = BaseColumnFilter & {
  operator: 'plfts'
  config?: string
  value: string
}

export type PhraseFtsColumnFilter = BaseColumnFilter & {
  operator: 'phfts'
  config?: string
  value: string
}

export type WebSearchFtsColumnFilter = BaseColumnFilter & {
  operator: 'wfts'
  config?: string
  value: string
}

export type ColumnFilter =
  | EqColumnFilter
  | NeqColumnFilter
  | GtColumnFilter
  | GteColumnFilter
  | LtColumnFilter
  | LteColumnFilter
  | LikeColumnFilter
  | IlikeColumnFilter
  | MatchColumnFilter
  | ImatchColumnFilter
  | IsColumnFilter
  | InColumnFilter
  | FtsColumnFilter
  | PlainFtsColumnFilter
  | PhraseFtsColumnFilter
  | WebSearchFtsColumnFilter

export type LogicalFilter = BaseFilter & {
  type: 'logical'
  operator: LogicalOperator
  values: Filter[]
}

export type Filter = ColumnFilter | LogicalFilter

/**
 * Represents a direct column target in the select.
 */
export type ColumnTarget = {
  type: 'column-target'
  column: string
  alias?: string
  cast?: string
}

export type JoinedColumn = {
  relation: string
  column: string
}

/**
 * Represents a resource embedding (joined) target in the select.
 */
export type EmbeddedTarget = {
  type: 'embedded-target'
  relation: string
  targets: Target[]
  joinType: 'left' | 'inner'
  joinedColumns: {
    left: JoinedColumn
    right: JoinedColumn
  }
  alias?: string
  flatten?: boolean
}

export type BaseAggregateTarget = {
  type: 'aggregate-target'
  alias?: string
  outputCast?: string
}

export type ColumnAggregateTarget = BaseAggregateTarget & {
  functionName: string
  column: string
  inputCast?: string
}

/**
 * Special case `count()` aggregate target that works
 * with no column attached.
 */
export type CountAggregateTarget = BaseAggregateTarget & {
  type: 'aggregate-target'
  functionName: 'count'
}

/**
 * Represents a aggregate target in the select.
 */
export type AggregateTarget = CountAggregateTarget | ColumnAggregateTarget

export type Target = ColumnTarget | AggregateTarget | EmbeddedTarget

export type Sort = {
  column: string
  direction?: 'asc' | 'desc'
  nulls?: 'first' | 'last'
}

export type Relations = {
  primary: {
    name: string
    alias?: string
    get reference(): string
  }
  joined: EmbeddedTarget[]
}
