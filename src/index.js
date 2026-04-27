'use strict';

const Parser = require('rss-parser');
const https = require('https');

const RSS_FEEDS = [
  { url: 'https://techcrunch.com/category/artificial-intelligence/feed/', country: '🇺🇸 US' },
  { url: 'https://venturebeat.com/category/ai/feed/', country: '🇺🇸 US' },
  { url: 'https://www.theguardian.com/technology/artificialintelligenceai/rss', country: '🇬🇧 UK' },
  { url: 'https://rss.dw.com/rdf/rss-en-tech', country: '🇩🇪 DE' },
  { url: 'https://www.scmp.com/rss/5/feed', country: '🇨🇳 CN' },
];

const AI_KEYWORDS = [
  'ai', 'artificial intelligence', 'machine learning', 'llm', 'gpt', 'claude',
  'gemini', 'neural', 'deep learning', 'openai', 'anthropic', 'deepmind',
  'chatgpt', 'robotics', 'automation', 'large language model', 'generative ai',
  'mistral', 'meta ai', 'foundation model',
];

async function fetchAllNews() {
  const parser = new Parser({ timeout: 10000 });
  const allItems = [];

  for (const feed of RSS_FEEDS) {
    try {
      const result = await parser.parseURL(feed.url);
      for (const item of (result.items || []).slice(0, 20)) {
        allItems.push({
          title: (item.title || '').trim(),
          link: item.link || '',
          pubDate: item.pubDate ? new Date(item.pubDate) : new Date(0),
          country: feed.country,
          snippet: (item.contentSnippet || item.summary || '').slice(0, 400),
        });
      }
      console.log(`  ✓ ${feed.country} (${new URL(feed.url).hostname}): ${result.items?.length ?? 0}件`);
    } catch (e) {
      console.warn(`  ✗ ${feed.country} (${new URL(feed.url).hostname}): ${e.message}`);
    }
  }

  return allItems;
}

function filterAINews(items) {
  const cutoff = new Date(Date.now() - 48 * 60 * 60 * 1000);

  const filtered = items.filter(item => {
    if (item.pubDate < cutoff) return false;
    const text = `${item.title} ${item.snippet}`.toLowerCase();
    return AI_KEYWORDS.some(kw => text.includes(kw));
  });

  filtered.sort((a, b) => b.pubDate - a.pubDate);

  const seen = new Set();
  return filtered.filter(item => {
    const key = item.title.toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 30);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  }).slice(0, 20);
}

async function summarizeNews(items) {
  const useAnthropic = !!process.env.ANTHROPIC_API_KEY;
  const useOpenAI = !!process.env.OPENAI_API_KEY;

  if (!useAnthropic && !useOpenAI) {
    throw new Error('ANTHROPIC_API_KEY または OPENAI_API_KEY を設定してください');
  }

  const newsText = items.map((item, i) =>
    `[${i + 1}] ${item.country}\nタイトル: ${item.title}\nURL: ${item.link}\n内容: ${item.snippet}`
  ).join('\n\n');

  const prompt = `以下のAIニュース記事を日本語に翻訳・要約してください。
各記事を1〜2文で簡潔に要約し、以下のJSON配列形式で返してください。

[
  {
    "title": "日本語タイトル（簡潔に）",
    "summary": "1〜2文の日本語要約",
    "url": "元のURL",
    "country": "国旗+国名（例: 🇺🇸 US）"
  }
]

記事一覧:
${newsText}

JSONのみを返してください。コードブロック記法は不要です。`;

  if (useAnthropic) {
    const Anthropic = require('@anthropic-ai/sdk');
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const response = await client.messages.create({
      model: 'claude-haiku-4-5-20251001',
      max_tokens: 4096,
      messages: [{ role: 'user', content: prompt }],
    });
    const text = response.content[0].text;
    return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
  } else {
    const OpenAI = require('openai');
    const client = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });
    const response = await client.chat.completions.create({
      model: 'gpt-4o-mini',
      messages: [{ role: 'user', content: prompt }],
      max_tokens: 4096,
    });
    const text = response.choices[0].message.content;
    return JSON.parse(text.match(/\[[\s\S]*\]/)[0]);
  }
}

function broadcastLineMessage(text) {
  const body = JSON.stringify({
    messages: [{ type: 'text', text }],
  });

  return new Promise((resolve, reject) => {
    const req = https.request({
      hostname: 'api.line.me',
      path: '/v2/bot/message/broadcast',
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${process.env.LINE_CHANNEL_ACCESS_TOKEN}`,
        'Content-Length': Buffer.byteLength(body),
      },
    }, (res) => {
      let data = '';
      res.on('data', c => (data += c));
      res.on('end', () =>
        res.statusCode < 300
          ? resolve()
          : reject(new Error(`LINE API ${res.statusCode}: ${data}`))
      );
    });
    req.on('error', reject);
    req.write(body);
    req.end();
  });
}

async function sendToLine(summarized) {
  const today = new Date().toLocaleDateString('ja-JP', {
    timeZone: 'Asia/Tokyo',
    year: 'numeric', month: 'long', day: 'numeric',
  });

  const chunks = [];
  let current = `🤖 AIニュース ${today}\n${'─'.repeat(20)}\n全${summarized.length}件\n\n`;

  for (let i = 0; i < summarized.length; i++) {
    const { title, summary, url, country } = summarized[i];
    const entry = `${i + 1}. ${country}\n📌 ${title}\n${summary}\n🔗 ${url}\n\n`;
    if (current.length + entry.length > 4800) {
      chunks.push(current.trimEnd());
      current = entry;
    } else {
      current += entry;
    }
  }
  if (current.trim()) chunks.push(current.trimEnd());

  for (const chunk of chunks) {
    await broadcastLineMessage(chunk);
  }
  return chunks.length;
}

async function main() {
  const missing = ['LINE_CHANNEL_ACCESS_TOKEN'].filter(k => !process.env[k]);
  if (missing.length) throw new Error(`環境変数が不足しています: ${missing.join(', ')}`);

  console.log('📡 RSSフィードを取得中...');
  const allItems = await fetchAllNews();
  console.log(`   合計 ${allItems.length} 件取得`);

  const filtered = filterAINews(allItems);
  console.log(`🔍 AIニュース ${filtered.length} 件に絞り込み`);

  if (filtered.length === 0) {
    console.log('⚠️  対象ニュースが見つかりませんでした');
    return;
  }

  console.log('✍️  日本語に要約中...');
  const summarized = await summarizeNews(filtered);
  console.log(`   ${summarized.length} 件を要約完了`);

  console.log('📲 LINEに送信中...');
  const msgCount = await sendToLine(summarized);
  console.log(`✅ 完了（${msgCount}件のメッセージを送信）`);
}

main().catch(err => {
  console.error('❌ エラー:', err.message);
  process.exit(1);
});
