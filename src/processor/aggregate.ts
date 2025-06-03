import type { ColumnRef } from '@supabase/pg-parser/17/types'
import { UnsupportedError } from '../errors.js'
import type { Relations, Target } from './types.js'
import { everyTarget, renderFields, someTarget } from './util.js'

export function validateGroupClause(
  groupClause: ColumnRef[],
  targets: Target[],
  relations: Relations
) {
  const groupByColumns = groupClause.map((columnRef) => {
    if (!columnRef.fields) {
      throw new UnsupportedError('Group by clause must contain at least one column')
    }
    return renderFields(columnRef.fields, relations) ?? []
  })

  if (
    !groupByColumns.every((column) =>
      someTarget(targets, (target, parent) => {
        // The `count()` special case aggregate has no column attached
        if (!('column' in target)) {
          return false
        }

        const path = parent
          ? // joined columns have to be prefixed with their relation
            [parent.alias && !parent.flatten ? parent.alias : parent.relation, target.column]
          : // top-level columns will have no prefix
            [target.column]

        const qualifiedName = path.join('.')
        return qualifiedName === column
      })
    )
  ) {
    throw new UnsupportedError(`Every group by column must also exist as a select target`)
  }

  if (
    someTarget(targets, (target) => target.type === 'aggregate-target') &&
    !everyTarget(targets, (target, parent) => {
      if (target.type === 'aggregate-target') {
        return true
      }

      const path = parent
        ? // joined columns have to be prefixed with their relation
          [parent.alias && !parent.flatten ? parent.alias : parent.relation, target.column]
        : // top-level columns will have no prefix
          [target.column]

      const qualifiedName = path.join('.')

      return groupByColumns.some((column) => qualifiedName === column)
    })
  ) {
    throw new UnsupportedError(
      `Every non-aggregate select target must also exist in a group by clause`
    )
  }

  if (
    groupByColumns.length > 0 &&
    !someTarget(targets, (target) => target.type === 'aggregate-target')
  ) {
    throw new UnsupportedError(
      `There must be at least one aggregate function in the select target list when using group by`
    )
  }
}
