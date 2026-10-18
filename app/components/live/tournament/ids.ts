/** shared-element id prefix for tournament covers (bracket → VS intro → voting) */
export const T_COVER = 'tc-';

/**
 * A cover URL for WebGL textures. The page already shows covers as plain
 * <img> (no CORS), and the browser would hand that cached, header-less copy
 * to a CORS request – which then fails. A distinct URL gets its own fetch.
 */
export const textureUrl = (url: string) => `${url}${url.includes('?') ? '&' : '?'}gl=1`;
