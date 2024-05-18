import { UnsupportedError } from '../errors'
import { A_Expr, WhereExpression } from '../types/libpg-query'
import { ColumnFilter, Filter, Relations } from './types'
import { parseConstant, processJsonTarget, renderFields } from './util'

export function processWhereClause(expression: WhereExpression, relations: Relations): Filter {
  if ('A_Expr' in expression) {
    let column: string

    if (expression.A_Expr.name.length > 1) {
      throw new UnsupportedError('Only one operator name supported per expression')
    }

    if ('A_Expr' in expression.A_Expr.lexpr) {
      try {
        const target = processJsonTarget(expression.A_Expr.lexpr, relations)
        column = target.column
      } catch (err) {
        throw new UnsupportedError(`Left side of WHERE clause must be a column`)
      }
    } else if ('ColumnRef' in expression.A_Expr.lexpr) {
      const { fields } = expression.A_Expr.lexpr.ColumnRef
      column = renderFields(fields, relations)
    } else if ('TypeCast' in expression.A_Expr.lexpr) {
      throw new UnsupportedError('Casting is not supported in the WHERE clause')
    } else {
      throw new UnsupportedError(`Left side of WHERE clause must be a column`)
    }

    const kind = expression.A_Expr.kind
    const [name] = expression.A_Expr.name
    const operatorSymbol = name.String.sval.toLowerCase()
    const operator = mapOperatorSymbol(kind, operatorSymbol)

    if (
      operator === 'eq' ||
      operator === 'neq' ||
      operator === 'gt' ||
      operator === 'gte' ||
      operator === 'lt' ||
      operator === 'lte'
    ) {
      if (!('A_Const' in expression.A_Expr.rexpr)) {
        throw new UnsupportedError(
          `Right side of WHERE clause '${operatorSymbol}' expression must be a constant`,
          `Did you forget to wrap your value in single quotes?`
        )
      }

      const value = parseConstant(expression.A_Expr.rexpr)
      return {
        type: 'column',
        column,
        operator,
        negate: false,
        value,
      }
    }
    // Between is not supported by PostgREST, but we can generate the equivalent using '>=' and '<='
    else if (
      operator === 'between' ||
      operator === 'between symmetric' ||
      operator === 'not between' ||
      operator === 'not between symmetric'
    ) {
      if (!('List' in expression.A_Expr.rexpr) || expression.A_Expr.rexpr.List.items.length !== 2) {
        throw new UnsupportedError(
          `Right side of WHERE clause '${operatorSymbol}' expression must contain two constants`
        )
      }

      let [leftValue, rightValue] = expression.A_Expr.rexpr.List.items.map((item) =>
        parseConstant(item)
      )

      // 'between symmetric' doesn't care which argument comes first order-wise,
      // ie. it auto swaps the arguments if the left value is greater than the right value
      if (operator.includes('symmetric')) {
        // We can only implement the symmetric logic if the values are numbers
        // If they're strings, they could be dates, text columns, etc which we can't sort here
        if (typeof leftValue !== 'number' || typeof rightValue !== 'number') {
          throw new UnsupportedError(`BETWEEN SYMMETRIC is only supported with number values`)
        }

        // If the left value is greater than the right, swap them
        if (leftValue > rightValue) {
          const temp = rightValue
          rightValue = leftValue
          leftValue = temp
        }
      }

      const leftFilter: ColumnFilter = {
        type: 'column',
        column,
        operator: 'gte',
        negate: false,
        value: leftValue,
      }

      const rightFilter: ColumnFilter = {
        type: 'column',
        column,
        operator: 'lte',
        negate: false,
        value: rightValue,
      }

      return {
        type: 'logical',
        operator: 'and',
        negate: operator.includes('not'),
        values: [leftFilter, rightFilter],
      }
    } else if (
      operator === 'like' ||
      operator === 'ilike' ||
      operator === 'match' ||
      operator === 'imatch'
    ) {
      if (!('A_Const' in expression.A_Expr.rexpr) || !('sval' in expression.A_Expr.rexpr.A_Const)) {
        throw new UnsupportedError(
          `Right side of WHERE clause '${operator}' expression must be a string constant`
        )
      }

      const value = expression.A_Expr.rexpr.A_Const.sval.sval

      return {
        type: 'column',
        column,
        operator,
        negate: false,
        value,
      }
    } else if (operator === 'in') {
      if (
        !('List' in expression.A_Expr.rexpr) ||
        !expression.A_Expr.rexpr.List.items.every((item) => 'A_Const' in item)
      ) {
        throw new UnsupportedError(
          `Right side of WHERE clause '${operator}' expression must be a list of constants`
        )
      }

      const value = expression.A_Expr.rexpr.List.items.map((item) => parseConstant(item))

      return {
        type: 'column',
        column,
        operator,
        negate: false,
        value,
      }
    } else {
      throw new UnsupportedError(`Unsupported operator '${operatorSymbol}'`)
    }
  } else if ('NullTest' in expression) {
    const { fields } = expression.NullTest.arg.ColumnRef

    const column = renderFields(fields, relations)
    const negate = expression.NullTest.nulltesttype === 'IS_NOT_NULL'
    const operator = 'is'
    const value = null

    return {
      type: 'column',
      column,
      operator,
      negate,
      value,
    }
  } else if ('BoolExpr' in expression) {
    let operator: 'and' | 'or' | 'not'

    if (expression.BoolExpr.boolop === 'AND_EXPR') {
      operator = 'and'
    } else if (expression.BoolExpr.boolop === 'OR_EXPR') {
      operator = 'or'
    } else if (expression.BoolExpr.boolop === 'NOT_EXPR') {
      operator = 'not'
    } else {
      throw new UnsupportedError(`Unknown boolop '${expression.BoolExpr.boolop}'`)
    }

    const values = expression.BoolExpr.args.map((arg) => processWhereClause(arg, relations))

    // The 'not' operator is special - instead of wrapping its child,
    // we just return the child directly and set negate=true on it.
    if (operator === 'not') {
      if (values.length > 1) {
        throw new UnsupportedError(
          `NOT expressions must have only 1 child, but received ${values.length} children`
        )
      }
      const [filter] = values
      filter.negate = true
      return filter
    }

    return {
      type: 'logical',
      operator,
      negate: false,
      values,
    }
  } else {
    throw new UnsupportedError(`The WHERE clause must contain an expression`)
  }
}

function mapOperatorSymbol(kind: A_Expr['A_Expr']['kind'], operatorSymbol: string) {
  switch (kind) {
    case 'AEXPR_OP': {
      switch (operatorSymbol) {
        case '=':
          return 'eq'
        case '<>':
          return 'neq'
        case '>':
          return 'gt'
        case '>=':
          return 'gte'
        case '<':
          return 'lt'
        case '<=':
          return 'lte'
        case '~':
          return 'match'
        case '~*':
          return 'imatch'
        default:
          throw new UnsupportedError(`Unsupported operator '${operatorSymbol}'`)
      }
    }
    case 'AEXPR_BETWEEN':
    case 'AEXPR_BETWEEN_SYM':
    case 'AEXPR_NOT_BETWEEN':
    case 'AEXPR_NOT_BETWEEN_SYM': {
      switch (operatorSymbol) {
        case 'between':
          return 'between'
        case 'between symmetric':
          return 'between symmetric'
        case 'not between':
          return 'not between'
        case 'not between symmetric':
          return 'not between symmetric'
        default:
          throw new UnsupportedError(`Unsupported operator '${operatorSymbol}'`)
      }
    }
    case 'AEXPR_LIKE': {
      switch (operatorSymbol) {
        case '~~':
          return 'like'
        default:
          throw new UnsupportedError(`Unsupported operator '${operatorSymbol}'`)
      }
    }
    case 'AEXPR_ILIKE': {
      switch (operatorSymbol) {
        case '~~*':
          return 'ilike'
        default:
          throw new UnsupportedError(`Unsupported operator '${operatorSymbol}'`)
      }
    }
    case 'AEXPR_IN': {
      switch (operatorSymbol) {
        case '=':
          return 'in'
        default:
          throw new UnsupportedError(`Unsupported operator '${operatorSymbol}'`)
      }
    }
  }
}
