import { environment } from './config.js';
import { database } from './db.js';
import { createApp } from './app.js';

const app = createApp(database, environment.JWT_ACCESS_SECRET);
app.listen(environment.API_PORT, '0.0.0.0', () => {
  console.info(`PlacePrep API listening on port ${environment.API_PORT}`);
});