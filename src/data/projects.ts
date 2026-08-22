// 字段全可选：/admin/manage 保存时只序列化非空字段，缺字段是合法状态
// （新增项目经 /admin/publish 写入时字段齐全）
export interface ProjectItem {
	name?: string;
	description?: string;
	techStack?: string[];
	tags?: string[];
	category?: string;
	cover?: string;
	github?: string;
	demo?: string;
	status?: string;
	featured?: boolean;
}

export const projects: ProjectItem[] = [];
