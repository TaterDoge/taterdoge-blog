import { getCollection } from "astro:content";
import { getImage } from "astro:assets";
import { getReadingMinutes } from "@/lib/reading-time";

const PER_PAGE = 10;

export async function loadArchiveData() {
	const posts = (await getCollection("blog"))
		.filter((post) => !post.data.draft && post.data.visibility === "public")
		.sort((a, b) => b.data.pubDate.valueOf() - a.data.pubDate.valueOf());
	const tags = Array.from(new Set(posts.flatMap((post) => post.data.tags)));
	const categories = Array.from(
		new Set(posts.map((post) => post.data.category)),
	);
	const totalMinutes = posts.reduce(
		(sum, post) => sum + getReadingMinutes(post.body),
		0,
	);

	const postData = await Promise.all(
		posts.map(async (post) => ({
			id: post.id,
			title: post.data.title,
			description: post.data.description,
			pubDate: post.data.pubDate.toISOString(),
			tags: post.data.tags,
			category: post.data.category,
			cover: post.data.cover
				? (
						await getImage({
							src: post.data.cover,
							width: Math.min(368, post.data.cover.width),
							format: "webp",
							quality: 80,
						})
					).src
				: undefined,
			readingMinutes: getReadingMinutes(post.body),
			search:
				`${post.data.title} ${post.data.description} ${post.data.category} ${post.data.tags.join(" ")}`.toLocaleLowerCase(),
		})),
	);

	const tagCountMap = Object.fromEntries(
		tags.map((tag) => [
			tag,
			posts.filter((post) => post.data.tags.includes(tag)).length,
		]),
	);
	const categoryCountMap = Object.fromEntries(
		categories.map((cat) => [
			cat,
			posts.filter((post) => post.data.category === cat).length,
		]),
	);

	return {
		posts,
		tags,
		categories,
		totalMinutes,
		postData,
		tagCountMap,
		categoryCountMap,
		totalPages: Math.max(1, Math.ceil(postData.length / PER_PAGE)),
	};
}
