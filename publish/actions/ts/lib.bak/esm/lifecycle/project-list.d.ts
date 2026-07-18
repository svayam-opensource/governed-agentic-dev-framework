/**
 * The `Projects` port (SDD Part D, manage) — list the org's GitHub Project boards.
 * GitHub-definitive (registry-elimination): the project universe is the org's
 * boards. gh-backed; injectable for tests.
 */
import type { RunGh } from "./gh-board.js";
export interface BoardSummary {
    readonly number: number;
    readonly title: string;
    readonly url: string;
    readonly closed: boolean;
}
export interface Projects {
    /** All Project boards for `owner` (open + closed). */
    listBoards(owner: string): BoardSummary[];
}
export declare function createGhProjects(runGh: RunGh): Projects;
