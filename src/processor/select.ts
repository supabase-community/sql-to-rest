import { UnsupportedError } from '../errors'
import {
  A_Const,
  A_Expr,
  ColumnRef,
  FromExpression,
  FuncCall,
  PgString,
  SelectResTarget,
  SelectStmt,
  TypeCast,
} from '../types/libpg-query'
import { validateGroupClause } from './aggregate'
import { processWhereClause } from './filter'
import { processLimit } from './limit'
import { processSortClause } from './sort'
import {
  AggregateTarget,
  ColumnTarget,
  EmbeddedTarget,
  JoinedColumn,
  Relations,
  Select,
  Target,
} from './types'
import { processJsonTarget, renderDataType, renderFields } from './util'

export const supportedAggregateFunctions = ['avg', 'count', 'max', 'min', 'sum']

export function processSelectStatement(stmt: SelectStmt): Select {
  if (!stmt.SelectStmt.fromClause) {
    throw new UnsupportedError('The query must have a from clause')
  }

  if (stmt.SelectStmt.fromClause.length > 1) {
    throw new UnsupportedError('Only one FROM source is supported')
  }

  if (stmt.SelectStmt.withClause) {
    throw new UnsupportedError('CTEs are not supported')
  }

  if (stmt.SelectStmt.distinctClause) {
    throw new UnsupportedError('SELECT DISTINCT is not supported')
  }

  if (stmt.SelectStmt.havingClause) {
    throw new UnsupportedError('The HAVING clause is not supported')
  }

  const [fromClause] = stmt.SelectStmt.fromClause

  const relations = processFromClause(fromClause)

  const from = relations.primary.name

  const targets = processTargetList(stmt.SelectStmt.targetList, relations)

  validateGroupClause(stmt.SelectStmt.groupClause ?? [], targets, relations)

  const filter = stmt.SelectStmt.whereClause
    ? processWhereClause(stmt.SelectStmt.whereClause, relations)
    : undefined

  const sorts = processSortClause(stmt.SelectStmt.sortClause ?? [], relations)

  const limit = processLimit(stmt)

  return {
    type: 'select',
    from,
    targets,
    filter,
    sorts,
    limit,
  }
}

function processFromClause(fromClause: FromExpression): Relations {
  if ('RangeVar' in fromClause) {
    return {
      primary: {
        name: fromClause.RangeVar.relname,
        alias: fromClause.RangeVar.alias?.aliasname,
        get reference() {
          return this.alias ?? this.name
        },
      },
      joined: [],
    }
  } else if ('JoinExpr' in fromClause) {
    const joinType = mapJoinType(fromClause.JoinExpr.jointype)
    const { primary, joined } = processFromClause(fromClause.JoinExpr.larg)

    const joinedRelationAlias = fromClause.JoinExpr.rarg.RangeVar.alias?.aliasname
    const joinedRelation = joinedRelationAlias ?? fromClause.JoinExpr.rarg.RangeVar.relname

    const existingRelations = [
      primary.reference,
      ...joined.map((t) => t.alias ?? t.relation),
      joinedRelation,
    ]

    if (!('A_Expr' in fromClause.JoinExpr.quals)) {
      throw new UnsupportedError(`Join qualifier must be an expression comparing columns`)
    }

    let leftQualifierRelation
    let rightQualifierRelation

    const joinQualifierExpression = fromClause.JoinExpr.quals.A_Expr

    if (!('ColumnRef' in joinQualifierExpression.lexpr)) {
      throw new UnsupportedError(`Left side of join qualifier must be a column`)
    }

    if (
      !joinQualifierExpression.lexpr.ColumnRef.fields.every(
        (field): field is PgString => 'String' in field
      )
    ) {
      throw new UnsupportedError(`Left side column of join qualifier must contain String fields`)
    }

    const leftColumnFields = joinQualifierExpression.lexpr.ColumnRef.fields.map(
      (field) => field.String.sval
    )

    // Relation and column names are last two parts of the qualified name
    const [leftRelationName] = leftColumnFields.slice(-2, -1)
    const [leftColumnName] = leftColumnFields.slice(-1)

    if (!leftRelationName) {
      leftQualifierRelation = primary.reference
    } else if (existingRelations.includes(leftRelationName)) {
      leftQualifierRelation = leftRelationName
    } else if (leftRelationName === joinedRelation) {
      leftQualifierRelation = joinedRelation
    } else {
      throw new UnsupportedError(
        `Left side of join qualifier references a different relation (${leftRelationName}) than the join (${existingRelations.join(', ')})`
      )
    }

    if (!('ColumnRef' in joinQualifierExpression.rexpr)) {
      throw new UnsupportedError(`Right side of join qualifier must be a column`)
    }

    if (
      !joinQualifierExpression.rexpr.ColumnRef.fields.every(
        (field): field is PgString => 'String' in field
      )
    ) {
      throw new UnsupportedError(`Right side column of join qualifier must contain String fields`)
    }

    const rightColumnFields = joinQualifierExpression.rexpr.ColumnRef.fields.map(
      (field) => field.String.sval
    )

    // Relation and column names are last two parts of the qualified name
    const [rightRelationName] = rightColumnFields.slice(-2, -1)
    const [rightColumnName] = rightColumnFields.slice(-1)

    if (!rightRelationName) {
      rightQualifierRelation = primary.reference
    } else if (existingRelations.includes(rightRelationName)) {
      rightQualifierRelation = rightRelationName
    } else if (rightRelationName === joinedRelation) {
      rightQualifierRelation = joinedRelation
    } else {
      throw new UnsupportedError(
        `Right side of join qualifier references a different relation (${rightRelationName}) than the join (${existingRelations.join(', ')})`
      )
    }

    if (rightQualifierRelation === leftQualifierRelation) {
      // TODO: support for recursive relationships
      throw new UnsupportedError(`Join qualifier cannot compare columns from same relation`)
    }

    if (rightQualifierRelation !== joinedRelation && leftQualifierRelation !== joinedRelation) {
      throw new UnsupportedError(`Join qualifier must reference a column from the joined table`)
    }

    const [qualifierOperatorString] = joinQualifierExpression.name

    if (qualifierOperatorString.String.sval !== '=') {
      throw new UnsupportedError(`Join qualifier operator must be '='`)
    }

    let left: JoinedColumn
    let right: JoinedColumn

    // If left qualifier referenced the joined relation, swap left and right
    if (rightQualifierRelation === joinedRelation) {
      left = {
        relation: leftQualifierRelation,
        column: leftColumnName,
      }
      right = {
        relation: rightQualifierRelation,
        column: rightColumnName,
      }
    } else {
      right = {
        relation: leftQualifierRelation,
        column: leftColumnName,
      }
      left = {
        relation: rightQualifierRelation,
        column: rightColumnName,
      }
    }

    const embeddedTarget: EmbeddedTarget = {
      type: 'embedded-target',
      relation: fromClause.JoinExpr.rarg.RangeVar.relname,
      alias: fromClause.JoinExpr.rarg.RangeVar.alias?.aliasname,
      joinType,
      targets: [], // these will be filled in later when processing the select target list
      flatten: true,
      joinedColumns: {
        left,
        right,
      },
    }

    return {
      primary,
      joined: [...joined, embeddedTarget],
    }
  } else {
    const [fieldType] = Object.keys(fromClause)
    throw new UnsupportedError(`Unsupported FROM clause type '${fieldType}'`)
  }
}

function processTargetList(targetList: SelectResTarget[], relations: Relations): Target[] {
  // First pass: map each SQL target column to a PostgREST target 1-to-1
  const flattenedColumnTargets: (ColumnTarget | AggregateTarget)[] = targetList.map((resTarget) => {
    const target = processTarget(resTarget.ResTarget.val, relations)
    target.alias = resTarget.ResTarget.name

    return target
  })

  // Second pass: transfer joined columns to `embeddedTargets`
  const columnTargets = flattenedColumnTargets.filter((target) => {
    // Account for the special case when the aggregate doesn't have a column attached
    // ie. `count()`: should always be applied to the top level relation
    if (target.type === 'aggregate-target' && !('column' in target)) {
      return true
    }

    const qualifiedName = target.column.split('.')

    // Relation and column names are last two parts of the qualified name
    const [relationName] = qualifiedName.slice(-2, -1)
    const [columnName] = qualifiedName.slice(-1)

    // If there is no prefix, this column belongs to the primary relation at the top level
    if (!relationName) {
      return true
    }

    // If this column is part of a joined relation
    if (relationName) {
      const embeddedTarget = relations.joined.find(
        (t) => (t.alias && !t.flatten ? t.alias : t.relation) === relationName
      )

      if (!embeddedTarget) {
        throw new UnsupportedError(
          `Found foreign column '${target.column}' in target list without a join to that relation`,
          'Did you forget to join that relation or alias it to something else?'
        )
      }

      // Strip relation from column name
      target.column = columnName

      // Nest the column in the embedded target
      embeddedTarget.targets.push(target)

      // Remove this column from the top level
      return false
    }

    return true
  })

  // Third pass: nest embedded targets within each other based on the relations in their join qualifiers
  const nestedEmbeddedTargets = relations.joined.reduce<EmbeddedTarget[]>(
    (output, embeddedTarget) => {
      // If the embedded target was joined with the primary relation, return it
      if (embeddedTarget.joinedColumns.left.relation === relations.primary.reference) {
        return [...output, embeddedTarget]
      }

      // Otherwise identify the correct parent and nest it within its targets
      const parent = relations.joined.find(
        (t) => (t.alias ?? t.relation) === embeddedTarget.joinedColumns.left.relation
      )

      if (!parent) {
        throw new UnsupportedError(
          `Something went wrong, could not find parent embedded target for nested embedded target '${embeddedTarget.relation}'`
        )
      }

      parent.targets.push(embeddedTarget)
      return output
    },
    []
  )

  return [...columnTargets, ...nestedEmbeddedTargets]
}

function processTarget(
  target: TypeCast | ColumnRef | FuncCall | A_Expr | A_Const,
  relations: Relations
): ColumnTarget | AggregateTarget {
  if ('TypeCast' in target) {
    return processCast(target, relations)
  } else if ('ColumnRef' in target) {
    return processColumn(target, relations)
  } else if ('A_Expr' in target) {
    return processExpression(target, relations)
  } else if ('FuncCall' in target) {
    return processFunctionCall(target, relations)
  } else {
    throw new UnsupportedError(
      'Only columns, JSON fields, and aggregates are supported as query targets'
    )
  }
}

function mapJoinType(joinType: string) {
  switch (joinType) {
    case 'JOIN_INNER':
      return 'inner'
    case 'JOIN_LEFT':
      return 'left'
    default:
      throw new UnsupportedError(`Unsupported join type '${joinType}'`)
  }
}

function processCast(target: TypeCast, relations: Relations) {
  const cast = renderDataType(target.TypeCast.typeName.names)

  if ('A_Const' in target.TypeCast.arg) {
    throw new UnsupportedError(
      'Only columns, JSON fields, and aggregates are supported as query targets'
    )
  }

  const nestedTarget = processTarget(target.TypeCast.arg, relations)

  const { type } = nestedTarget

  if (type === 'aggregate-target') {
    return {
      ...nestedTarget,
      outputCast: cast,
    }
  } else if (type === 'column-target') {
    return {
      ...nestedTarget,
      cast,
    }
  } else {
    throw new UnsupportedError(`Cannot process target with type '${type}'`)
  }
}

function processColumn(target: ColumnRef, relations: Relations): ColumnTarget {
  return {
    type: 'column-target',
    column: renderFields(target.ColumnRef.fields, relations),
  }
}

function processExpression(target: A_Expr, relations: Relations): ColumnTarget {
  try {
    return processJsonTarget(target, relations)
  } catch (err) {
    const maybeJsonHint =
      err instanceof Error && err.message === 'Invalid JSON path'
        ? 'Did you forget to quote a JSON path?'
        : undefined
    throw new UnsupportedError(`Expressions not supported as targets`, maybeJsonHint)
  }
}

function processFunctionCall(target: FuncCall, relations: Relations): AggregateTarget {
  const functionName = renderFields(target.FuncCall.funcname, relations)

  if (!supportedAggregateFunctions.includes(functionName)) {
    throw new UnsupportedError(
      `Only the following aggregate functions are supported: ${JSON.stringify(supportedAggregateFunctions)}`
    )
  }

  // The `count(*)` special case that has no columns attached
  if (functionName === 'count' && !target.FuncCall.args && target.FuncCall.agg_star) {
    return {
      type: 'aggregate-target',
      functionName,
    }
  }

  if (!target.FuncCall.args) {
    throw new UnsupportedError(`Aggregate function '${functionName}' requires a column argument`)
  }

  if (target.FuncCall.args && target.FuncCall.args.length > 1) {
    throw new UnsupportedError(`Aggregate functions only accept one argument`)
  }

  const [arg] = target.FuncCall.args

  const nestedTarget = processTarget(arg, relations)

  if (nestedTarget.type === 'aggregate-target') {
    throw new UnsupportedError(`Aggregate functions cannot contain another function`)
  }

  const { cast, ...columnTarget } = nestedTarget

  return {
    ...columnTarget,
    type: 'aggregate-target',
    functionName,
    inputCast: cast,
  }
}
