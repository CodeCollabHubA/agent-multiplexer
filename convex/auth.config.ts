import type { AuthConfig } from 'convex/server';
export default {
  providers: [{
    domain: process.env.AUTH0_DOMAIN ?? 'https://dev-4hw2emzs.eu.auth0.com',
    applicationID: process.env.AUTH0_CLIENT_ID ?? 'CGlOWL0HkW4FAgkAEWyBpFVCn6aCdNd5',
  }],
} satisfies AuthConfig;
