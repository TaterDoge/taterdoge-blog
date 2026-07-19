import { defineCollection, z } from "astro:content";
import { glob } from "astro/loaders";

const visibility = z.enum(["public", "private"]).default("public");

const blog = defineCollection({
	loader: glob({ base: "./src/content/blog", pattern: "**/*.{md,mdx}" }),
	schema: ({ image }) =>
		z.object({
			title: z.string(),
			description: z.string(),
			pubDate: z.coerce.date(),
			updatedDate: z.coerce.date().optional(),
			tags: z.array(z.string()).default([]),
			category: z.string(),
			draft: z.boolean().default(false),
			cover: image().optional(),
			syncToKb: z.boolean().default(false),
			visibility,
		}),
});

const notes = defineCollection({
	loader: glob({ base: "./src/content/notes", pattern: "**/*.{md,mdx}" }),
	schema: z.object({
		title: z.string(),
		pubDate: z.coerce.date(),
		mood: z.string().optional(),
		tags: z.array(z.string()).default([]),
		visibility,
		images: z.array(z.string()).default([]),
	}),
});

export const collections = { blog, notes };
