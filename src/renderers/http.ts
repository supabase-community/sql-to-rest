import { stripIndent } from 'common-tags'
import { RenderError } from '../errors.js'
import { Filter, Select, Insert, Update, Delete, Statement } from '../processor'
import { renderFilter, renderTargets, uriEncode, uriEncodeParams } from './util.js'

export type HttpRequest = {
  method: 'GET' | 'POST' | 'PATCH' | 'DELETE'
  path: string
  params: URLSearchParams
  body?: object
  fullPath: string
}

/**
 * Renders a `Statement` as an HTTP request.
 */
export async function renderHttp(processed: Statement): Promise<HttpRequest> {
  switch (processed.type) {
    case 'select':
      return formatSelect(processed)
    case 'insert':
      return formatInsert(processed)
    case 'update':
      return formatUpdate(processed)
    case 'delete':
      return formatDelete(processed)
  }
}

async function formatSelect(select: Select): Promise<HttpRequest> {
  const { from, targets, filter, sorts, limit } = select
  const params = new URLSearchParams()

  if (targets.length > 0) {
    const [firstTarget] = targets

    // Exclude "select=*" if it's the only target
    if (
      firstTarget!.type !== 'column-target' ||
      firstTarget!.column !== '*' ||
      targets.length !== 1
    ) {
      params.set('select', renderTargets(targets))
    }
  }

  if (filter) {
    renderFilterRoot(params, filter)
  }

  if (sorts) {
    const columns = []

    for (const sort of sorts) {
      let value = sort.column

      if (sort.direction) {
        value += `.${sort.direction}`
      }
      if (sort.nulls) {
        value += `.nulls${sort.nulls}`
      }

      columns.push(value)
    }

    if (columns.length > 0) {
      params.set('order', columns.join(','))
    }
  }

  if (limit) {
    if (limit.count !== undefined) {
      params.set('limit', limit.count.toString())
    }
    if (limit.offset !== undefined) {
      params.set('offset', limit.offset.toString())
    }
  }

  const path = `/${from}`

  return {
    method: 'GET',
    path,
    params,
    get fullPath() {
      // params.size not available in older runtimes
      if (Array.from(params).length > 0) {
        return `${path}?${uriEncodeParams(params)}`
      }
      return path
    },
  }
}

function renderFilterRoot(params: URLSearchParams, filter: Filter) {
  const { type } = filter

  // The `and` operator is a special case where we can format each nested
  // filter as a separate query param as long as the `and` is not negated
  if (type === 'logical' && filter.operator === 'and' && !filter.negate) {
    for (const subFilter of filter.values) {
      renderFilterRoot(params, subFilter)
    }
  }
  // Otherwise render as normal
  else {
    const [key, value] = renderFilter(filter)
    params.append(key, value)
  }
}

export function formatHttp(baseUrl: string, httpRequest: HttpRequest) {
  const { method, fullPath, body } = httpRequest
  const baseUrlObject = new URL(baseUrl)
  
  let headers = ''
  let requestBody = ''
  
  if (body && (method === 'POST' || method === 'PATCH')) {
    headers = 'Content-Type: application/json\n'
    requestBody = `\n${JSON.stringify(body, null, 2)}`
  }

  return stripIndent`
    ${method} ${baseUrlObject.pathname}${fullPath} HTTP/1.1
    Host: ${baseUrlObject.host}${headers}${requestBody}
  `
}

export function formatCurl(baseUrl: string, httpRequest: HttpRequest) {
  const { method, path, params, body } = httpRequest
  const lines: string[] = []
  const baseUrlObject = new URL(baseUrl)
  const formattedBaseUrl = (baseUrlObject.origin + baseUrlObject.pathname).replace(/\/+$/, '')
  const maybeGFlag = params.size > 0 ? '-G ' : ''

  if (method === 'GET') {
    lines.push(`curl ${maybeGFlag}${formattedBaseUrl}${path}`)
    for (const [key, value] of params) {
      lines.push(`  -d "${uriEncode(key)}=${uriEncode(value)}"`)
    }
  } else if (method === 'POST' || method === 'PATCH') {
    lines.push(`curl -X ${method} ${formattedBaseUrl}${path}`)
    for (const [key, value] of params) {
      lines.push(`  -d "${uriEncode(key)}=${uriEncode(value)}"`)
    }
    if (body) {
      lines.push(`  -H "Content-Type: application/json"`)
      lines.push(`  -d '${JSON.stringify(body)}'`)
    }
  } else if (method === 'DELETE') {
    lines.push(`curl -X DELETE ${formattedBaseUrl}${path}`)
    for (const [key, value] of params) {
      lines.push(`  -d "${uriEncode(key)}=${uriEncode(value)}"`)
    }
  }

  return lines.join(' \\\n')
}

async function formatInsert(insert: Insert): Promise<HttpRequest> {
  const { into, columns, values, returning } = insert
  const params = new URLSearchParams()
  
  // Convert values to objects
  const body = values.map(row => {
    const obj: Record<string, any> = {}
    columns.forEach((col, index) => {
      obj[col] = row[index]
    })
    return obj
  })

  // Handle RETURNING clause
  if (returning && returning.length > 0) {
    params.set('select', returning.join(','))
  }

  const path = `/${into}`

  return {
    method: 'POST',
    path,
    params,
    body: body.length === 1 ? body[0] : body,
    get fullPath() {
      if (Array.from(params).length > 0) {
        return `${path}?${uriEncodeParams(params)}`
      }
      return path
    },
  }
}

async function formatUpdate(update: Update): Promise<HttpRequest> {
  const { table, set, filter, returning } = update
  const params = new URLSearchParams()

  // Handle RETURNING clause
  if (returning && returning.length > 0) {
    params.set('select', returning.join(','))
  }

  // Add filters as query parameters
  if (filter) {
    renderFilterRoot(params, filter)
  }

  const path = `/${table}`

  return {
    method: 'PATCH',
    path,
    params,
    body: set,
    get fullPath() {
      if (Array.from(params).length > 0) {
        return `${path}?${uriEncodeParams(params)}`
      }
      return path
    },
  }
}

async function formatDelete(deleteStmt: Delete): Promise<HttpRequest> {
  const { from, filter, returning } = deleteStmt
  const params = new URLSearchParams()

  // Handle RETURNING clause
  if (returning && returning.length > 0) {
    params.set('select', returning.join(','))
  }

  // Add filters as query parameters
  if (filter) {
    renderFilterRoot(params, filter)
  }

  const path = `/${from}`

  return {
    method: 'DELETE',
    path,
    params,
    get fullPath() {
      if (Array.from(params).length > 0) {
        return `${path}?${uriEncodeParams(params)}`
      }
      return path
    },
  }
}
