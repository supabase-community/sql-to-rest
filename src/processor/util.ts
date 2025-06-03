import type { A_Const, A_Expr, Node, String } from '@supabase/pg-parser/17/types'
import { UnsupportedError } from '../errors.js'
import type {
  AggregateTarget,
  ColumnFilter,
  ColumnTarget,
  EmbeddedTarget,
  Filter,
  Relations,
  Target,
} from './types.js'

export function processJsonTarget(expression: A_Expr, relations: Relations): ColumnTarget {
  if (!expression.name || expression.name.length === 0) {
    throw new UnsupportedError('JSON operator must have a name')
  }

  if (expression.name.length > 1) {
    throw new UnsupportedError('Only one operator name supported per expression')
  }

  const [name] = expression.name

  if (!('String' in name!)) {
    throw new UnsupportedError('JSON operator name must be a string')
  }

  const operator = name.String.sval

  if (!operator) {
    throw new UnsupportedError('JSON operator name cannot be empty')
  }

  if (!['->', '->>'].includes(operator)) {
    throw new UnsupportedError(`Invalid JSON operator`)
  }

  let cast: string | undefined = undefined
  let left: string | number
  let right: string | number

  if (!expression.lexpr) {
    throw new UnsupportedError('JSON path must have a left expression')
  }

  if ('A_Const' in expression.lexpr) {
    // JSON path cannot contain a float
    if ('fval' in expression.lexpr.A_Const) {
      throw new UnsupportedError('Invalid JSON path')
    }
    left = parseConstant(expression.lexpr.A_Const)
  } else if ('A_Expr' in expression.lexpr) {
    const { column } = processJsonTarget(expression.lexpr.A_Expr, relations)
    left = column
  } else if ('ColumnRef' in expression.lexpr) {
    if (!expression.lexpr.ColumnRef.fields) {
      throw new UnsupportedError('JSON path must have a column reference')
    }
    left = renderFields(expression.lexpr.ColumnRef.fields, relations)
  } else {
    throw new UnsupportedError('Invalid JSON path')
  }

  if (!expression.rexpr || !expression.rexpr) {
    throw new UnsupportedError('JSON path must have a right expression')
  }

  if ('A_Const' in expression.rexpr) {
    // JSON path cannot contain a float
    if ('fval' in expression.rexpr.A_Const) {
      throw new UnsupportedError('Invalid JSON path')
    }
    right = parseConstant(expression.rexpr.A_Const)
  } else if ('TypeCast' in expression.rexpr) {
    if (!expression.rexpr.TypeCast.typeName?.names) {
      throw new UnsupportedError('Type cast must have a name')
    }
    cast = renderDataType(
      expression.rexpr.TypeCast.typeName.names.map((n) => {
        if (!('String' in n)) {
          throw new UnsupportedError('Type cast name must be a string')
        }
        return n.String
      })
    )

    if (!expression.rexpr.TypeCast.arg) {
      throw new UnsupportedError('Type cast must have an argument')
    }

    if ('A_Const' in expression.rexpr.TypeCast.arg) {
      if ('sval' in expression.rexpr.TypeCast.arg.A_Const) {
        if (!expression.rexpr.TypeCast.arg.A_Const.sval?.sval) {
          throw new UnsupportedError('Type cast argument cannot be empty')
        }
        right = expression.rexpr.TypeCast.arg.A_Const.sval.sval
      } else {
        throw new UnsupportedError('Invalid JSON path')
      }
    } else {
      throw new UnsupportedError('Invalid JSON path')
    }
  } else {
    throw new UnsupportedError('Invalid JSON path')
  }

  return {
    type: 'column-target',
    column: `${left}${operator}${right}`,
    cast,
  }
}

export function renderFields(
  fields: Node[],
  relations: Relations,
  syntax: 'dot' | 'parenthesis' = 'dot'
): string {
  // Get qualified column name segments, eg. `author.name` -> ['author', 'name']
  const nameSegments = fields.map((field) => {
    if ('String' in field) {
      return field.String.sval
    } else if ('A_Star' in field) {
      return '*'
    } else {
      const [internalType] = Object.keys(field)
      throw new UnsupportedError(`Unsupported internal type '${internalType}' for data type names`)
    }
  })

  // Relation and column names are last two parts of the qualified name
  const [relationOrAliasName] = nameSegments.slice(-2, -1)
  const [columnName] = nameSegments.slice(-1)

  const joinedRelation = relations.joined.find(
    (t) => (t.alias ?? t.relation) === relationOrAliasName
  )

  // If the column is prefixed with the primary relation, strip the prefix
  if (!relationOrAliasName || relationOrAliasName === relations.primary.reference) {
    if (!columnName) {
      throw new UnsupportedError('Column name cannot be empty')
    }
    return columnName
  }
  // If it's prefixed with a joined relation in the FROM clause, keep the relation prefix
  else if (joinedRelation) {
    // Joined relations that are spread don't support aliases, so we will
    // convert the alias back to the original relation name in this case
    const joinedRelationName = joinedRelation.flatten
      ? joinedRelation.relation
      : relationOrAliasName

    if (syntax === 'dot') {
      return [joinedRelationName, columnName].join('.')
    } else if (syntax === 'parenthesis') {
      return `${joinedRelationName}(${columnName})`
    } else {
      throw new Error(`Unknown render syntax '${syntax}'`)
    }
  }
  // If it's prefixed with an unknown relation, throw an error
  else {
    const qualifiedName = [relationOrAliasName, columnName].join('.')

    throw new UnsupportedError(
      `Found foreign column '${qualifiedName}' without a join to that relation`,
      'Did you forget to join that relation or alias it to something else?'
    )
  }
}

export function renderDataType(names: String[]) {
  const [first, ...rest] = names

  if (!first) {
    throw new UnsupportedError('Data type must have a name')
  }

  if (first.sval === 'pg_catalog' && rest.length === 1) {
    const [name] = rest

    if (!name) {
      throw new UnsupportedError('Data type must have a name')
    }

    // The PG parser converts some data types, eg. int -> pg_catalog.int4
    // so we'll map those back
    switch (name.sval) {
      case 'int2':
        return 'smallint'
      case 'int4':
        return 'int'
      case 'int8':
        return 'bigint'
      case 'float8':
        return 'float'
      default:
        return name.sval
    }
  } else if (rest.length > 0) {
    throw new UnsupportedError(
      `Casts can only reference data types by their unqualified name (not schema-qualified)`
    )
  } else {
    return first.sval
  }
}

export function parseConstant(constant: A_Const) {
  if ('sval' in constant) {
    if (constant.sval?.sval === undefined) {
      throw new UnsupportedError('Constant value cannot be empty')
    }
    return constant.sval.sval
  } else if ('ival' in constant) {
    if (constant.ival === undefined) {
      throw new UnsupportedError('Constant value cannot be undefined')
    }
    // The PG parser turns 0 into undefined, so convert it back here
    return constant.ival.ival ?? 0
  } else if ('fval' in constant) {
    if (constant.fval?.fval === undefined) {
      throw new UnsupportedError('Constant value cannot be undefined')
    }
    return parseFloat(constant.fval.fval)
  } else {
    throw new UnsupportedError(`Constant values must be a string, integer, or float`)
  }
}

/**
 * Recursively flattens PostgREST embedded targets.
 */
export function flattenTargets(targets: Target[]): Target[] {
  return targets.flatMap((target) => {
    const { type } = target
    if (type === 'column-target' || type === 'aggregate-target') {
      return target
    } else if (type === 'embedded-target') {
      return [target, ...flattenTargets(target.targets)]
    } else {
      throw new UnsupportedError(`Unknown target type '${type}'`)
    }
  })
}

/**
 * Recursively iterates through PostgREST filters and checks if the predicate
 * matches any of them (ie. `some()`).
 */
export function someFilter(filter: Filter, predicate: (filter: ColumnFilter) => boolean): boolean {
  const { type } = filter

  if (type === 'column') {
    return predicate(filter)
  } else if (type === 'logical') {
    return filter.values.some((f) => someFilter(f, predicate))
  } else {
    throw new UnsupportedError(`Unknown filter type '${type}'`)
  }
}

/**
 * Recursively iterates through a PostgREST target list and checks if the predicate
 * matches every one of them (ie. `some()`).
 */
export function everyTarget(
  targets: Target[],
  predicate: (target: ColumnTarget | AggregateTarget, parent?: EmbeddedTarget) => boolean,
  parent?: EmbeddedTarget
): boolean {
  return targets.every((target) => {
    const { type } = target

    if (type === 'column-target' || type === 'aggregate-target') {
      return predicate(target, parent)
    } else if (type === 'embedded-target') {
      return everyTarget(target.targets, predicate, target)
    } else {
      throw new UnsupportedError(`Unknown target type '${type}'`)
    }
  })
}

/**
 * Recursively iterates through a PostgREST target list and checks if the predicate
 * matches any of them (ie. `some()`).
 */
export function someTarget(
  targets: Target[],
  predicate: (target: ColumnTarget | AggregateTarget, parent?: EmbeddedTarget) => boolean,
  parent?: EmbeddedTarget
): boolean {
  return targets.some((target) => {
    const { type } = target

    if (type === 'column-target' || type === 'aggregate-target') {
      return predicate(target, parent)
    } else if (type === 'embedded-target') {
      return someTarget(target.targets, predicate, target)
    } else {
      throw new UnsupportedError(`Unknown target type '${type}'`)
    }
  })
}
