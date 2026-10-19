/**
 * VARDHAN — LIVE SOURCE REGISTRY
 * ─────────────────────────────────────────────────────────────────────────────
 * Central registry of high-frequency technical sources.
 * This allows VARDHAN to pivot from "company-first crawling" to "source-first intelligence."
 */

export type LiveSourceMode =
  | 'LIVE_STATUS'       // Poll frequently for incidents/state
  | 'ENGINEERING_FEED'   // Poll daily for architectural artifacts
  | 'COMMUNITY_STREAM'   // Poll frequently for developer pain/discovery
  | 'BEHAVIORAL_TARGET'; // Safe direct observation endpoints

export interface LiveSourceDefinition {
  id: string;
  name: string;
  url: string;
  mode: LiveSourceMode;
  refreshMinutes: number;
  supportsHistory: boolean;
  supportsStructuredData: boolean;
  supportsDirectObservation: boolean;
  discoveryOnly: boolean;
}

export const LIVE_SOURCE_REGISTRY: LiveSourceDefinition[] = [
  // --- OPERATIONAL STATUS (LIVE_STATUS) ---
  { id: 'aws_health', name: 'AWS Health', url: 'https://health.aws.amazon.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'gcp_health', name: 'GCP Health', url: 'https://status.cloud.google.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'azure_status', name: 'Azure Status', url: 'https://azure.status.microsoft/en-us/status', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'github_status', name: 'GitHub Status', url: 'https://www.githubstatus.com/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'vercel_status', name: 'Vercel Status', url: 'https://www.vercel-status.com/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'cloudflare_status', name: 'Cloudflare Status', url: 'https://www.cloudflarestatus.com/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'openai_status', name: 'OpenAI Status', url: 'https://status.openai.com/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'anthropic_status', name: 'Anthropic Status', url: 'https://status.anthropic.com/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'supabase_status', name: 'Supabase Status', url: 'https://status.supabase.com/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'sentry_status', name: 'Sentry Status', url: 'https://status.sentry.io/', mode: 'LIVE_STATUS', refreshMinutes: 30, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'twilio_status', name: 'Twilio Status', url: 'https://status.twilio.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'atlassian_status', name: 'Atlassian Status', url: 'https://status.atlassian.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'circleci_status', name: 'CircleCI Status', url: 'https://status.circleci.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'elastic_status', name: 'Elastic Status', url: 'https://status.elastic.co/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'mongodb_status', name: 'MongoDB Status', url: 'https://status.mongodb.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'confluent_status', name: 'Confluent Status', url: 'https://status.confluent.cloud/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'do_status', name: 'DigitalOcean Status', url: 'https://status.digitalocean.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'render_status', name: 'Render Status', url: 'https://status.render.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'netlify_status', name: 'Netlify Status', url: 'https://www.netlifystatus.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'fly_status', name: 'Fly.io Status', url: 'https://status.flyio.net/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'figma_status', name: 'Figma Status', url: 'https://status.figma.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'pagerduty_status', name: 'PagerDuty Status', url: 'https://status.pagerduty.com/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'npm_status', name: 'npm Status', url: 'https://status.npmjs.org/', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },
  { id: 'stripe_reach', name: 'Stripe Reachability', url: 'https://status.stripe.com/reachability', mode: 'LIVE_STATUS', refreshMinutes: 60, supportsHistory: false, supportsStructuredData: true, supportsDirectObservation: true, discoveryOnly: false },

  // --- ENGINEERING FEEDS (ENGINEERING_FEED) ---
  { id: 'shopify_eng', name: 'Shopify Engineering', url: 'https://shopify.engineering/latest', mode: 'ENGINEERING_FEED', refreshMinutes: 1440, supportsHistory: true, supportsStructuredData: false, supportsDirectObservation: false, discoveryOnly: false },
  { id: 'uber_eng', name: 'Uber Engineering', url: 'https://www.uber.com/us/en/blog/engineering/', mode: 'ENGINEERING_FEED', refreshMinutes: 1440, supportsHistory: true, supportsStructuredData: false, supportsDirectObservation: false, discoveryOnly: false },
  { id: 'cloudflare_eng', name: 'Cloudflare Engineering', url: 'https://blog.cloudflare.com/tag/engineering/', mode: 'ENGINEERING_FEED', refreshMinutes: 1440, supportsHistory: true, supportsStructuredData: false, supportsDirectObservation: false, discoveryOnly: false },
  { id: 'datadog_eng', name: 'Datadog Engineering', url: 'https://www.datadoghq.com/blog/engineering/', mode: 'ENGINEERING_FEED', refreshMinutes: 1440, supportsHistory: true, supportsStructuredData: false, supportsDirectObservation: false, discoveryOnly: false },
  { id: 'gitlab_eng', name: 'GitLab Engineering', url: 'https://about.gitlab.com/blog/categories/engineering/', mode: 'ENGINEERING_FEED', refreshMinutes: 1440, supportsHistory: true, supportsStructuredData: false, supportsDirectObservation: false, discoveryOnly: false },

  // --- COMMUNITY STREAMS (COMMUNITY_STREAM) ---
  { id: 'so_newest', name: 'StackOverflow Newest', url: 'https://stackoverflow.com/questions', mode: 'COMMUNITY_STREAM', refreshMinutes: 15, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: false, discoveryOnly: true },
  { id: 'hn_newest', name: 'Hacker News Newest', url: 'https://news.ycombinator.com/newest', mode: 'COMMUNITY_STREAM', refreshMinutes: 15, supportsHistory: true, supportsStructuredData: true, supportsDirectObservation: false, discoveryOnly: true },
];
