import rss from "@astrojs/rss";
import { getCollection } from "astro:content";
import { siteConfig } from "@/data/site";

export async function GET(context: { site: URL }) {
  const posts = (await getCollection("blog"))
    .filter((post) => !post.data.draft && post.data.visibility === "public")
    .sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());

  return rss({
    title: siteConfig.title,
    description: siteConfig.description,
    site: context.site,
    items: posts.map((post) => ({
      title: post.data.title,
      description: post.data.description,
      pubDate: post.data.pubDate,
      link: `/blog/${post.id}/`,
    })),
  });
}
