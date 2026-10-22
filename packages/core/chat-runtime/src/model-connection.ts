import { lookup as dnsLookup } from 'node:dns/promises'
import { request as httpRequest } from 'node:http'
import { request as httpsRequest } from 'node:https'
import { BlockList, isIP } from 'node:net'
import { Readable } from 'node:stream'

export interface ModelAddressOptions {
    allowedLocalOrigins?: readonly string[]
}

const forbidden = new BlockList()
const forbiddenV6 = new BlockList()
forbidden.addSubnet('0.0.0.0', 8)
forbidden.addSubnet('169.254.0.0', 16)
forbidden.addSubnet('224.0.0.0', 4)
forbidden.addSubnet('240.0.0.0', 4)
forbidden.addAddress('100.100.100.200')
forbidden.addAddress('168.63.129.16')
forbiddenV6.addSubnet('::', 96, 'ipv6')
forbiddenV6.addSubnet('::ffff:0:0', 96, 'ipv6')
forbiddenV6.addSubnet('fe80::', 10, 'ipv6')
forbiddenV6.addSubnet('ff00::', 8, 'ipv6')
forbiddenV6.addAddress('fd00:ec2::254', 'ipv6')
forbiddenV6.addAddress('fd20:ce::254', 'ipv6')

const privateAddresses = new BlockList()
const privateV6 = new BlockList()
for (const [address, prefix] of [
    ['10.0.0.0', 8],
    ['127.0.0.0', 8],
    ['172.16.0.0', 12],
    ['192.168.0.0', 16],
    ['100.64.0.0', 10],
    ['192.0.0.0', 24],
    ['192.0.2.0', 24],
    ['198.18.0.0', 15],
    ['198.51.100.0', 24],
    ['203.0.113.0', 24],
] as const)
    privateAddresses.addSubnet(address, prefix)
privateV6.addSubnet('fc00::', 7, 'ipv6')
privateV6.addSubnet('2001:db8::', 32, 'ipv6')
privateV6.addSubnet('2001::', 32, 'ipv6')
privateV6.addSubnet('2002::', 16, 'ipv6')

const globalV6 = new BlockList()
globalV6.addSubnet('2000::', 3, 'ipv6')

/**
 * Resolve model DNS within a short deadline and respect immediate cancellation.
 * @param host - Validated hostname without URL syntax.
 * @param signal - Optional caller cancellation.
 * @returns All resolved addresses for all-or-nothing policy verification.
 * @throws Error for resolution failure, deadline, or cancellation.
 */
async function resolveModelHost(host: string, signal?: AbortSignal | null) {
    let timer: ReturnType<typeof setTimeout> | undefined
    let onAbort: (() => void) | undefined
    try {
        return await Promise.race([
            dnsLookup(host, { all: true, verbatim: true }),
            new Promise<never>((_resolve, reject) => {
                timer = setTimeout(() => reject(new Error('模型地址解析超时。')), 5000)
                timer.unref()
                onAbort = () => reject(new Error('模型请求已取消。'))
                signal?.addEventListener('abort', onAbort, { once: true })
                if (signal?.aborted) onAbort()
            }),
        ])
    } finally {
        if (timer) clearTimeout(timer)
        if (onAbort) signal?.removeEventListener('abort', onAbort)
    }
}

/**
 * Check a literal address against permanent and public-network restrictions.
 * @param address - Canonical IP returned by DNS or supplied in a URL.
 * @param localAllowed - Whether the administrator approved this exact origin.
 * @returns Whether the address may receive model credentials.
 */
export function isAllowedModelAddress(address: string, localAllowed = false): boolean {
    const version = isIP(address)
    if (!version) return false
    const family = version === 4 ? 'ipv4' : 'ipv6'
    if (version === 6 && address === '::1') return localAllowed
    if ((version === 4 ? forbidden : forbiddenV6).check(address, family)) return false
    if ((version === 4 ? privateAddresses : privateV6).check(address, family)) return localAllowed
    if (version === 6 && !globalV6.check(address, 'ipv6')) return false
    return true
}

/**
 * Validate and normalize a user model base URL without making network requests.
 * @param value - User-supplied API base, normally ending in /v1.
 * @param options - Administrator-owned exact origins allowed for local models.
 * @returns The normalized base without a trailing slash.
 * @throws Error when the protocol, authority, or literal target is unsafe.
 */
export function validateModelBaseUrl(value: string, options: ModelAddressOptions = {}): string {
    let url: URL
    try {
        url = new URL(value.trim())
    } catch {
        throw new Error('请输入有效的模型 Base URL。')
    }
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash)
        throw new Error('模型地址只允许 HTTP(S)，不能包含凭据、查询参数或片段。')
    const localAllowed = (options.allowedLocalOrigins ?? []).includes(url.origin)
    if (url.protocol !== 'https:' && !localAllowed) throw new Error('请使用 HTTPS 模型地址；本地接口须由服务器明确授权。')
    const host = url.hostname.replace(/^\[|\]$/g, '').toLowerCase()
    if (
        host === 'metadata.google.internal' ||
        host === 'metadata' ||
        (isIP(host) && !isAllowedModelAddress(host, localAllowed)) ||
        (!isIP(host) && !localAllowed && (!host.includes('.') || /\.(localhost|local|internal)$/.test(host)))
    )
        throw new Error('该模型地址不在允许的连接范围内。')
    return url.href.replace(/\/+$/, '')
}

/**
 * Create a server transport that validates DNS and pins the actual socket target.
 * @param options - Administrator-owned address policy, never supplied by a browser.
 * @returns A fetch-compatible streaming transport with no redirect following.
 */
export function createModelFetch(options: ModelAddressOptions = {}): typeof fetch {
    /**
     * Resolve one approved origin and perform a bounded request to that exact IP.
     * @param input - Absolute Chat Completions endpoint.
     * @param init - Headers, body, and the caller's combined cancellation signal.
     * @returns A streamed provider response without following redirects.
     * @throws Error for forbidden addresses, redirects, network errors, or cancellation.
     */
    async function modelFetch(input: string | URL | Request, init: RequestInit = {}): Promise<Response> {
        const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url)
        validateModelBaseUrl(url.href, options)
        init.signal?.throwIfAborted()
        const host = url.hostname.replace(/^\[|\]$/g, '')
        const localAllowed = (options.allowedLocalOrigins ?? []).includes(url.origin)
        const resolution = isIP(host) ? [{ address: host, family: isIP(host) }] : await resolveModelHost(host, init.signal)
        init.signal?.throwIfAborted()
        if (!resolution.length || resolution.some(item => !isAllowedModelAddress(item.address, localAllowed)))
            throw new Error('模型地址解析到不允许的网络。')
        const selected = resolution[0]!
        return new Promise<Response>((resolve, reject) => {
            const transport = url.protocol === 'https:' ? httpsRequest : httpRequest
            const headers = Object.fromEntries(new Headers(init.headers))
            const request = transport(
                url,
                {
                    method: init.method ?? 'POST',
                    headers,
                    signal: init.signal ?? undefined,
                    family: selected.family,
                    // Resolve once above; TLS still verifies the original URL hostname.
                    lookup: (_hostname, _lookupOptions, callback) => callback(null, selected.address, selected.family),
                    agent: false,
                },
                response => {
                    try {
                        if ([204, 205, 304].includes(response.statusCode ?? 0)) {
                            response.destroy()
                            reject(new Error('模型接口未返回有效的流式响应。'))
                            return
                        }
                        if ((response.statusCode ?? 500) >= 300 && (response.statusCode ?? 500) < 400) {
                            response.destroy()
                            reject(new Error('模型接口不允许重定向。'))
                            return
                        }
                        let bytes = 0
                        const body = (Readable.toWeb(response) as ReadableStream<Uint8Array>).pipeThrough(
                            new TransformStream({
                                /**
                                 * Bound the total streamed response before parsing SSE frames.
                                 * @param chunk - Received provider bytes.
                                 * @param controller - Browser-independent stream destination.
                                 * @returns Nothing after forwarding an accepted chunk.
                                 * @throws Error when the response exceeds eight MiB.
                                 */
                                transform(chunk: Uint8Array, controller) {
                                    bytes += chunk.byteLength
                                    if (bytes > 8 * 1024 * 1024) throw new Error('模型响应超过允许大小。')
                                    controller.enqueue(chunk)
                                },
                            })
                        )
                        resolve(
                            new Response(body, {
                                status: response.statusCode ?? 500,
                                headers: { 'content-type': String(response.headers['content-type'] ?? '') },
                            })
                        )
                    } catch {
                        response.destroy()
                        reject(new Error('模型响应格式无效。'))
                    }
                }
            )
            request.on('error', reject)
            request.setTimeout(15_000, () => request.destroy(new Error('模型连接超时。')))
            request.end(typeof init.body === 'string' ? init.body : undefined)
        })
    }
    return modelFetch as typeof fetch
}
