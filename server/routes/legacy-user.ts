import { Router } from 'express';
import usersRoutes from './users';

const legacyUserRouter = Router();

legacyUserRouter.use((req, res, next) => {
  // Proxy legacy /api/user requests to the /api/users/me handlers
  const suffix = req.url === '/' ? '' : req.url;
  req.url = `/me${suffix}`;
  usersRoutes(req, res, next);
});

export default legacyUserRouter;
