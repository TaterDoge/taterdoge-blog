export const siteConfig = {
	name: "TaterDoge",
	title: "TaterDoge的小站",
	description: "记录灵感、收藏美好、折腾有趣的东西",
	avatar: "/images/personal.jpg",
	socials: [
		{
			name: "GitHub",
			href: "https://github.com/TaterDoge",
			icon: "Github",
			inHeader: true,
		},
		// { name: "Bilibili", href: "https://space.bilibili.com/", icon: "Tv" },
		// { name: "X", href: "https://x.com/", icon: "MessageCircle" },
		{ name: "Email", href: "mailto:taterdoge.email@gmail.com", icon: "Mail" },
		{ name: "RSS", href: "/rss.xml", icon: "Rss", inHeader: true },
	],
	music: {
		provider: "qq",
		playlistId: "1474643291",
		metingApi: "/api/music/meting?server=:server&type=:type&id=:id",
	},
};

export const nowItems = [
	"给小站换了一套清爽的新皮肤",
	"在研究更有趣的交互和动效",
	"收藏夹里攒了不少好东西准备整理",
];

// 正在进行
export const learningItems = [
	{ name: "Bun", status: "学习中", progress: 60, checked: true },
	{ name: "设计模式", status: "复盘中", progress: 40, checked: false },
	{ name: "Agent 架构", status: "进行中", progress: 30, checked: false },
];

// 周计划
export const weeklyGoal = "输出 2 篇笔记，顺手整理到个人知识库";
