import { Injectable, Inject } from '@angular/core';
import { HttpClient, HttpErrorResponse } from '@angular/common/http';
import { Observable, of, catchError, map } from 'rxjs';
import { GRID_CONFIG, GridConfig } from '../tokens/grid-tokens';

export interface GiphyImage {
  url: string;
  width: string;
  height: string;
  size?: string;
  mp4?: string;
  webp?: string;
}

export interface GiphyImages {
  original: GiphyImage;
  fixed_height: GiphyImage;
  fixed_height_small: GiphyImage;
  fixed_width: GiphyImage;
  fixed_width_small: GiphyImage;
  downsized: GiphyImage;
  downsized_medium: GiphyImage;
  downsized_small: GiphyImage;
  preview_gif: GiphyImage;
}

export interface GiphyGifData {
  id: string;
  title: string;
  url: string;
  images: GiphyImages;
}

export interface GiphyApiResponse {
  data: GiphyGifData[];
  pagination: { total_count: number; count: number; offset: number };
  meta: { status: number; msg: string };
}

export interface GiphyGif {
  id: string;
  title: string;
  previewUrl: string;
  url: string;
  originalUrl: string;
  width: number;
  height: number;
}

@Injectable()
export class GridGifService {
  private readonly apiUrl = 'https://api.giphy.com/v1/gifs';
  private readonly apiKey: string;
  private trendingCache: GiphyGif[] | null = null;

  constructor(
    private http: HttpClient,
    @Inject(GRID_CONFIG) private config: GridConfig
  ) {
    this.apiKey = config.giphyApiKey;
  }

  isConfigured(): boolean {
    return !!this.apiKey && this.apiKey.length > 0;
  }

  searchGifs(query: string, limit = 20, offset = 0): Observable<GiphyGif[]> {
    if (!this.isConfigured()) { console.warn('GIPHY API key not configured'); return of([]); }
    if (!query || query.trim().length === 0) return of([]);

    const params = {
      api_key: this.apiKey, q: query.trim(),
      limit: limit.toString(), offset: offset.toString(),
      rating: 'g', lang: 'en',
    };
    return this.http.get<GiphyApiResponse>(`${this.apiUrl}/search`, { params }).pipe(
      map(response => this.transformGifs(response.data)),
      catchError(this.handleError)
    );
  }

  getTrendingGifs(limit = 20): Observable<GiphyGif[]> {
    if (!this.isConfigured()) { console.warn('GIPHY API key not configured'); return of([]); }
    if (this.trendingCache && this.trendingCache.length > 0) return of(this.trendingCache);

    const params = { api_key: this.apiKey, limit: limit.toString(), rating: 'g' };
    return this.http.get<GiphyApiResponse>(`${this.apiUrl}/trending`, { params }).pipe(
      map(response => { const gifs = this.transformGifs(response.data); this.trendingCache = gifs; return gifs; }),
      catchError(this.handleError)
    );
  }

  private transformGifs(data: GiphyGifData[]): GiphyGif[] {
    return data.map(gif => ({
      id: gif.id, title: gif.title || 'GIF',
      previewUrl: gif.images.fixed_height_small?.url || gif.images.fixed_height?.url || gif.images.original.url,
      url: gif.images.fixed_height?.url || gif.images.downsized?.url || gif.images.original.url,
      originalUrl: gif.images.original.url,
      width: parseInt(gif.images.fixed_height?.width || gif.images.original.width, 10),
      height: parseInt(gif.images.fixed_height?.height || gif.images.original.height, 10),
    }));
  }

  private handleError(error: HttpErrorResponse): Observable<GiphyGif[]> {
    if (error.status === 429) console.error('GIPHY API rate limit exceeded');
    else if (error.status === 403) console.error('GIPHY API key invalid or missing');
    else console.error('GIPHY API error:', error.message);
    return of([]);
  }

  isGiphyUrl(url: string): boolean {
    if (!url) return false;
    const giphyPatterns = [/^https?:\/\/media\d*\.giphy\.com\/media\//i, /^https?:\/\/giphy\.com\/gifs\//i, /^https?:\/\/i\.giphy\.com\//i];
    return giphyPatterns.some(pattern => pattern.test(url));
  }

  normalizeGiphyUrl(url: string): string {
    if (/^https?:\/\/media\d*\.giphy\.com/i.test(url)) return url;
    if (/^https?:\/\/i\.giphy\.com/i.test(url)) return url;
    return url;
  }
}
