import type { SortBy } from '@supabase/pg-parser/17/types'
import { UnsupportedError } from '../errors.js'
import type { Relations, Sort } from './types.js'
import { processJsonTarget, renderFields } from './util.js'

export function processSortClause(sorts: SortBy[], relations: Relations): Sort[] {
  return sorts.map((sortBy) => {
    let column: string

    if (!sortBy.node) {
      throw new UnsupportedError(`ORDER BY clause must reference a column`)
    }

    if ('A_Expr' in sortBy.node) {
      try {
        const target = processJsonTarget(sortBy.node.A_Expr, relations)
        column = target.column
      } catch (err) {
        throw new UnsupportedError(`ORDER BY clause must reference a column`)
      }
    } else if ('ColumnRef' in sortBy.node) {
      const { fields } = sortBy.node.ColumnRef
      if (!fields) {
        throw new UnsupportedError(`ORDER BY clause must reference a column`)
      }
      column = renderFields(fields, relations, 'parenthesis')
    } else if ('TypeCast' in sortBy.node) {
      throw new UnsupportedError('Casting is not supported in the ORDER BY clause')
    } else {
      throw new UnsupportedError(`ORDER BY clause must reference a column`)
    }

    if (!sortBy.sortby_dir) {
      throw new UnsupportedError(`ORDER BY clause must specify a direction`)
    }

    const direction = mapSortByDirection(sortBy.sortby_dir)

    if (!sortBy.sortby_nulls) {
      throw new UnsupportedError(`ORDER BY clause must specify nulls handling`)
    }

    const nulls = mapSortByNulls(sortBy.sortby_nulls)

    return {
      column,
      direction,
      nulls,
    }
  })
}

function mapSortByDirection(direction: string) {
  switch (direction) {
    case 'SORTBY_ASC':
      return 'asc'
    case 'SORTBY_DESC':
      return 'desc'
    case 'SORTBY_DEFAULT':
      return undefined
    default:
      throw new UnsupportedError(`Unknown sort by direction '${direction}'`)
  }
}

function mapSortByNulls(nulls: string) {
  switch (nulls) {
    case 'SORTBY_NULLS_FIRST':
      return 'first'
    case 'SORTBY_NULLS_LAST':
      return 'last'
    case 'SORTBY_NULLS_DEFAULT':
      return undefined
    default:
      throw new UnsupportedError(`Unknown sort by nulls '${nulls}'`)
  }
}
