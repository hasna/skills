export interface Options {
  base: string;
  head?: string;
  format: 'github' | 'gitlab' | 'bitbucket' | 'plain';
  output?: string;
  includeFiles: boolean;
  template?: string;
  staged: boolean;
  unstaged: boolean;
  noAi: boolean;
  model: string;
  copy: boolean;
  verbose: boolean;
}

export interface GitDiffResult {
  diff: string;
  stats: {
    filesChanged: number;
    insertions: number;
    deletions: number;
  };
  files: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
}

export interface CommitInfo {
  hash: string;
  message: string;
  author: string;
  date: string;
}

export interface PRDescription {
  summary: string;
  changes: string[];
  whatChanged: {
    added: string[];
    modified: string[];
    deleted: string[];
  };
  whyChanged: string;
  breakingChanges: string[];
  testPlan: string[];
  additionalNotes: string[];
}
