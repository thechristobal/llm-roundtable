// CloudFront rejects a cache policy that lists forwarded headers (or cookies
// or query strings) when all TTLs are 0: "HeaderBehavior is invalid for
// policy with caching disabled". We hit this in a real deploy once. Running
// this as a synth-time Aspect means an accidental reintroduction fails
// `cdk synth`/`deploy` before CloudFormation sees it.
import { IAspect, Annotations } from 'aws-cdk-lib'
import { CfnCachePolicy } from 'aws-cdk-lib/aws-cloudfront'
import { IConstruct } from 'constructs'

export class CachePolicySanity implements IAspect {
  visit(node: IConstruct): void {
    if (!(node instanceof CfnCachePolicy)) return
    const cfg = node.cachePolicyConfig as CfnCachePolicy.CachePolicyConfigProperty
    const ttls = [cfg.defaultTtl, cfg.minTtl, cfg.maxTtl]
    const cachingDisabled = ttls.every(t => t === 0)
    if (!cachingDisabled) return

    const params = cfg.parametersInCacheKeyAndForwardedToOrigin as
      | CfnCachePolicy.ParametersInCacheKeyAndForwardedToOriginProperty
      | undefined
    const hdr = (params?.headersConfig as CfnCachePolicy.HeadersConfigProperty | undefined)?.headerBehavior
    const cookie = (params?.cookiesConfig as CfnCachePolicy.CookiesConfigProperty | undefined)?.cookieBehavior
    const qs = (params?.queryStringsConfig as CfnCachePolicy.QueryStringsConfigProperty | undefined)
      ?.queryStringBehavior

    const bad: string[] = []
    if (hdr && hdr !== 'none') bad.push(`headerBehavior=${hdr}`)
    if (cookie && cookie !== 'none') bad.push(`cookieBehavior=${cookie}`)
    if (qs && qs !== 'none') bad.push(`queryStringBehavior=${qs}`)
    if (bad.length === 0) return

    Annotations.of(node).addError(
      `CachePolicy ${node.node.path} has all TTLs=0 but sets ${bad.join(', ')}. ` +
        `CloudFront rejects this ("parameter is invalid for policy with caching disabled"). ` +
        `Move forwarded headers/cookies/query-strings to the OriginRequestPolicy instead.`,
    )
  }
}
