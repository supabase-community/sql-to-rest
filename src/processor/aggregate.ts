import { UnsupportedError } from '../errors'
import { ColumnRef } from '../types/libpg-query'
import { Relations, Target } from './types'
import { everyTarget, renderFields, someTarget } from './util'

export function validateGroupClause(
  groupClause: ColumnRef[],
  targets: Target[],
  relations: Relations
) {
  const groupByColumns =
    groupClause.map((columnRef) => renderFields(columnRef.ColumnRef.fields, relations)) ?? []

  if (
    !groupByColumns.every((column) =>
      someTarget(targets, (target, parent) => {
        // The `count()` special case aggregate has no column attached
        if (!('column' in target)) {
          return false
        }

        const path = parent
          ? // joined columns have to be prefixed with their relation
            [parent.alias ?? parent.relation, target.column]
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
          [parent.alias ?? parent.relation, target.column]
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
