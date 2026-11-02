export interface RagArticle {
  id: string;
  title: string;
  category: string;
  content: string;
  allowedRoles?: string[];
  keywords?: string[];
}

export class RagEngine {
  private articles: RagArticle[] = [];

  constructor(initialArticles: RagArticle[] = []) {
    this.articles = initialArticles;
  }

  addArticle(article: RagArticle): void {
    this.articles.push(article);
  }

  setArticles(articles: RagArticle[]): void {
    this.articles = articles;
  }

  /**
   * Retrieves relevant articles filtered by user role and keyword similarity.
   */
  search(query: string, userRole: string = 'USER', limit: number = 3): RagArticle[] {
    const qTokens = this.tokenize(query);
    if (qTokens.length === 0) return [];

    const scored = this.articles
      .filter(art => {
        if (!art.allowedRoles || art.allowedRoles.length === 0) return true;
        return art.allowedRoles.includes(userRole) || art.allowedRoles.includes('ALL');
      })
      .map(art => {
        const textToMatch = `${art.title} ${art.category} ${(art.keywords || []).join(' ')} ${art.content}`.toLowerCase();
        let score = 0;
        for (const token of qTokens) {
          if (textToMatch.includes(token)) score += 1;
        }
        return { article: art, score };
      })
      .filter(item => item.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map(item => item.article);

    return scored;
  }

  private tokenize(text: string): string[] {
    return text
      .toLowerCase()
      .replace(/[^\p{L}\p{N}\s]/gu, ' ')
      .split(/\s+/)
      .filter(t => t.length > 2);
  }
}
