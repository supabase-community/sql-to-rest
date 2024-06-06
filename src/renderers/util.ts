import { Filter, Target } from '../processor'

// TODO: format multiline targets downstream instead of here
export function renderTargets(
  targets: Target[],
  multiline?: { initialIndent: number; indent: number }
) {
  const indentation = multiline ? ' '.repeat(multiline.initialIndent) : ''
  const maybeNewline = multiline ? '\n' : ''

  return targets
    .map((target) => {
      // Regular columns
      if (target.type === 'column-target') {
        const { column, alias, cast } = target
        let value = column

        if (alias && alias !== column) {
          value = `${alias}:${value}`
        }

        if (cast) {
          value = `${value}::${cast}`
        }

        value = `${indentation}${value}`

        return value
      }
      // Special case for `count()` that has no column attached
      else if (target.type === 'aggregate-target' && !('column' in target)) {
        const { functionName, alias, outputCast } = target
        let value = `${functionName}()`

        if (alias) {
          value = `${alias}:${value}`
        }

        if (outputCast) {
          value = `${value}::${outputCast}`
        }

        value = `${indentation}${value}`

        return value
      }
      // Aggregate functions
      else if (target.type === 'aggregate-target') {
        const { column, alias, functionName, inputCast, outputCast } = target
        let value = column

        if (alias && alias !== column) {
          value = `${alias}:${value}`
        }

        if (inputCast) {
          value = `${value}::${inputCast}`
        }

        value = `${value}.${functionName}()`

        if (outputCast) {
          value = `${value}::${outputCast}`
        }

        value = `${indentation}${value}`

        return value
      }
      // Resource embeddings (joined tables)
      else if (target.type === 'embedded-target') {
        const { relation, alias, joinType, targets, flatten } = target
        let value = relation

        if (joinType === 'inner') {
          value = `${value}!inner`
        }

        // Resource embeddings can't have aliases when they're spread (flattened)
        if (alias && alias !== relation && !flatten) {
          value = `${alias}:${value}`
        }

        if (flatten) {
          value = `...${value}`
        }

        if (targets.length > 0) {
          value = `${indentation}${value}(${maybeNewline}${renderTargets(targets, multiline ? { ...multiline, initialIndent: multiline.initialIndent + multiline.indent } : undefined)}${maybeNewline}${indentation})`
        } else {
          value = `${indentation}${value}()`
        }

        return value
      }
    })
    .join(',' + maybeNewline)
}

/**
 * Renders a filter in PostgREST syntax.
 *
 * @returns A key-value pair that can be used either directly
 * in query params (for HTTP rendering), or to render nested
 * filters (@see `renderNestedFilter`).
 */
export function renderFilter(
  filter: Filter,
  urlSafe: boolean = true,
  delimiter = ','
): [key: string, value: string] {
  const { type } = filter
  const maybeNot = filter.negate ? 'not.' : ''

  // Column filter, eg. "title.eq.Cheese"
  if (type === 'column') {
    if (filter.operator === 'like' || filter.operator === 'ilike') {
      // Optionally convert '%' to URL-safe '*'
      const value = urlSafe ? filter.value.replaceAll('%', '*') : filter.value

      return [filter.column, `${maybeNot}${filter.operator}.${value}`]
    } else if (filter.operator === 'in') {
      const value = filter.value
        .map((value) => {
          // If an 'in' value contains a comma, wrap in double quotes
          if (value.toString().includes(',')) {
            return `"${value}"`
          }
          return value
        })
        .join(',')
      return [filter.column, `${maybeNot}${filter.operator}.(${value})`]
    } else if (
      filter.operator === 'fts' ||
      filter.operator === 'plfts' ||
      filter.operator === 'phfts' ||
      filter.operator === 'wfts'
    ) {
      const maybeConfig = filter.config ? `(${filter.config})` : ''
      return [filter.column, `${maybeNot}${filter.operator}${maybeConfig}.${filter.value}`]
    } else {
      return [filter.column, `${maybeNot}${filter.operator}.${filter.value}`]
    }
  }
  // Logical operator filter, eg. "or(title.eq.Cheese,title.eq.Salsa)""
  else if (type === 'logical') {
    return [
      `${maybeNot}${filter.operator}`,
      `(${filter.values
        .map((subFilter) => renderNestedFilter(subFilter, urlSafe, delimiter))
        .join(delimiter)})`,
    ]
  } else {
    throw new Error(`Unknown filter type '${type}'`)
  }
}

/**
 * Renders a filter in PostgREST syntax with key-values combined
 * for use within a nested filter.
 *
 * @returns A string containing the nested filter.
 */
export function renderNestedFilter(filter: Filter, urlSafe: boolean = true, delimiter = ',') {
  const [key, value] = renderFilter(filter, urlSafe, delimiter)
  const { type } = filter

  if (type === 'column') {
    return `${key}.${value}`
  } else if (type === 'logical') {
    return `${key}${value}`
  } else {
    throw new Error(`Unknown filter type '${type}'`)
  }
}

export const defaultCharacterWhitelist = ['*', '(', ')', ',', ':', '!', '>', '-', '[', ']']

/**
 * URI encodes query parameters with an optional character whitelist
 * that should not be encoded.
 */
export function uriEncodeParams(
  params: URLSearchParams,
  characterWhitelist: string[] = defaultCharacterWhitelist
) {
  return uriDecodeCharacters(params.toString(), characterWhitelist)
}

/**
 * URI encodes a string with an optional character whitelist
 * that should not be encoded.
 */
export function uriEncode(value: string, characterWhitelist: string[] = defaultCharacterWhitelist) {
  return uriDecodeCharacters(encodeURIComponent(value), characterWhitelist)
}

function uriDecodeCharacters(value: string, characterWhitelist: string[]) {
  let newValue = value

  // Convert whitelisted characters back from their hex representation (eg. '%2A' -> '*')
  for (const char of characterWhitelist) {
    const hexCode = char.charCodeAt(0).toString(16).toUpperCase()
    newValue = newValue.replaceAll(`%${hexCode}`, char)
  }

  return newValue
}
