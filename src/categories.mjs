// What job a connector does, guessed from its name, URL host or package.
// Used to spot overlap: two servers in the same category usually mean one is idle.
export const CATEGORIES = [
  ['email', /gmail|outlook|mail(?!chimp)|postmark|sendgrid|resend|imap/i],
  ['calendar', /calendar|cal\.com|calendly/i],
  ['chat', /slack|discord|teams|telegram|whatsapp|mattermost/i],
  ['project tracker', /linear|jira|atlassian|asana|clickup|monday|trello|shortcut|height|plane\b/i],
  ['docs & wiki', /notion|confluence|coda|gdrive|google.?drive|dropbox|box\.com|sharepoint|obsidian/i],
  ['browser automation', /playwright|puppeteer|browser|chrome|selenium|browserbase|stagehand/i],
  ['product analytics', /amplitude|mixpanel|posthog|pendo|heap|segment|similarweb/i],
  ['design', /figma|canva|sketch|penpot/i],
  ['meeting notes', /fireflies|otter|fathom|gong|granola/i],
  ['support inbox', /intercom|zendesk|freshdesk|helpscout|front\b/i],
  ['data warehouse', /bigquery|snowflake|databricks|redshift|clickhouse/i],
  ['database', /postgres|mysql|sqlite|supabase|mongo|neon|planetscale|turso|redis/i],
  ['code hosting', /github|gitlab|bitbucket/i],
  ['web search', /brave|tavily|exa\b|serp|perplexity|search/i],
  ['web fetch', /fetch|firecrawl|scrape|crawl/i],
  ['filesystem', /filesystem|file-?system|\bfs\b/i],
  ['memory', /memory|mem0|knowledge.?graph/i],
  ['cloud infra', /aws|gcp|azure|cloudflare|vercel|netlify|kubernetes|k8s|terraform/i],
  ['payments', /stripe|paypal|square/i],
  ['app runner', /baton|simulator|xcode|expo/i],
];

export function categorize(text) {
  const found = [];
  for (const [cat, re] of CATEGORIES) if (re.test(text)) found.push(cat);
  return found;
}
