import { UnsupportedError } from '../errors'
import { SortBy } from '../types/libpg-query'
import { Relations, Sort } from './types'
import { processJsonTarget, renderFields } from './util'

export function processSortClause(sorts: SortBy[], relations: Relations): Sort[] {
  return sorts.map((sortBy) => {
    let column: string

    if ('A_Expr' in sortBy.SortBy.node) {
      try {
        const target = processJsonTarget(sortBy.SortBy.node, relations)
        column = target.column
      } catch (err) {
        throw new UnsupportedError(`ORDER BY clause must reference a column`)
      }
    } else if ('ColumnRef' in sortBy.SortBy.node) {
      const { fields } = sortBy.SortBy.node.ColumnRef
      column = renderFields(fields, relations)
    } else if ('TypeCast' in sortBy.SortBy.node) {
      throw new UnsupportedError('Casting is not supported in the ORDER BY clause')
    } else {
      throw new UnsupportedError(`ORDER BY clause must reference a column`)
    }

    const direction = mapSortByDirection(sortBy.SortBy.sortby_dir)
    const nulls = mapSortByNulls(sortBy.SortBy.sortby_nulls)

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
