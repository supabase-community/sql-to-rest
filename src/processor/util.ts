import { UnsupportedError } from '../errors'
import { A_Const, A_Expr, Field, PgString } from '../types/libpg-query'
import {
  AggregateTarget,
  ColumnFilter,
  ColumnTarget,
  EmbeddedTarget,
  Filter,
  Relations,
  Target,
} from './types'

export function processJsonTarget(expression: A_Expr, relations: Relations): ColumnTarget {
  if (expression.A_Expr.name.length > 1) {
    throw new UnsupportedError('Only one operator name supported per expression')
  }

  const [name] = expression.A_Expr.name
  const operator = name.String.sval

  if (!['->', '->>'].includes(operator)) {
    throw new UnsupportedError(`Invalid JSON operator`)
  }

  let cast: string | undefined = undefined
  let left: string | number
  let right: string | number

  if ('A_Const' in expression.A_Expr.lexpr) {
    // JSON path cannot contain a float
    if ('fval' in expression.A_Expr.lexpr.A_Const) {
      throw new UnsupportedError('Invalid JSON path')
    }
    left = parseConstant(expression.A_Expr.lexpr)
  } else if ('A_Expr' in expression.A_Expr.lexpr) {
    const { column } = processJsonTarget(expression.A_Expr.lexpr, relations)
    left = column
  } else if ('ColumnRef' in expression.A_Expr.lexpr) {
    left = renderFields(expression.A_Expr.lexpr.ColumnRef.fields, relations)
  } else {
    throw new UnsupportedError('Invalid JSON path')
  }

  if ('A_Const' in expression.A_Expr.rexpr) {
    // JSON path cannot contain a float
    if ('fval' in expression.A_Expr.rexpr.A_Const) {
      throw new UnsupportedError('Invalid JSON path')
    }
    right = parseConstant(expression.A_Expr.rexpr)
  } else if ('TypeCast' in expression.A_Expr.rexpr) {
    cast = renderDataType(expression.A_Expr.rexpr.TypeCast.typeName.names)

    if ('A_Const' in expression.A_Expr.rexpr.TypeCast.arg) {
      if ('sval' in expression.A_Expr.rexpr.TypeCast.arg.A_Const) {
        right = expression.A_Expr.rexpr.TypeCast.arg.A_Const.sval.sval
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
  fields: Field[],
  relations: Relations,
  syntax: 'dot' | 'parenthesis' = 'dot'
) {
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

export function renderDataType(names: PgString[]) {
  const [first, ...rest] = names

  if (first.String.sval === 'pg_catalog' && rest.length === 1) {
    const [name] = rest

    // The PG parser converts some data types, eg. int -> pg_catalog.int4
    // so we'll map those back
    switch (name.String.sval) {
      case 'int2':
        return 'smallint'
      case 'int4':
        return 'int'
      case 'int8':
        return 'bigint'
      case 'float8':
        return 'float'
      default:
        return name.String.sval
    }
  } else if (rest.length > 0) {
    throw new UnsupportedError(
      `Casts can only reference data types by their unqualified name (not schema-qualified)`
    )
  } else {
    return first.String.sval
  }
}

export function parseConstant(constant: A_Const) {
  if ('sval' in constant.A_Const) {
    return constant.A_Const.sval.sval
  } else if ('ival' in constant.A_Const) {
    // The PG parser turns 0 into undefined, so convert it back here
    return constant.A_Const.ival.ival ?? 0
  } else if ('fval' in constant.A_Const) {
    return parseFloat(constant.A_Const.fval.fval)
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
