'use strict';

const path = require('path');
const express = require('express');
const session = require('express-session');
const cookieParser = require('cookie-parser');
const flash = require('connect-flash');
const helmet = require('helmet');
const morgan = require('morgan');
const methodOverride = require('method-override');
const expressLayouts = require('express-ejs-layouts');

const config = require('./config');
const prisma = require('./config/prisma');
const constants = require('./config/constants');
const fmt = require('./utils/format');
const jsonUtil = require('./utils/json');

const { loadUser } = require('./middleware/auth');
const { csrf } = require('./middleware/csrf');
const limiters = require('./middleware/rateLimit');

function createApp() {
  const app = express();

  // ---------------------------------------------------------------
  // View engine
  // ---------------------------------------------------------------
  app.set('view engine', 'ejs');
  app.set('views', path.join(config.rootDir, 'views'));
  app.set('trust proxy', 1); // Hostinger/Nginx terminates TLS in front of us

  app.use(expressLayouts);
  app.set('layout', 'layouts/public');
  app.set('layout extractScripts', true);
  app.set('layout extractStyles', true);

  // ---------------------------------------------------------------
  // Security headers
  // ---------------------------------------------------------------
  app.use(
    helmet({
      contentSecurityPolicy: {
        directives: {
          defaultSrc: ["'self'"],
          // Inline styles/scripts are used by the dashboards and the chart bootstrapping.
          styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
          scriptSrc: ["'self'", "'unsafe-inline'"],
          fontSrc: ["'self'", 'https://fonts.gstatic.com', 'data:'],
          imgSrc: ["'self'", 'data:', 'https:'],
          connectSrc: ["'self'"],
          frameSrc: ["'self'"],
          objectSrc: ["'none'"],
          baseUri: ["'self'"],
          formAction: ["'self'"],
        },
      },
      // Allows the payment gateway to hand the browser back to us via a top-level POST.
      crossOriginEmbedderPolicy: false,
      crossOriginResourcePolicy: { policy: 'same-site' },
      referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
    }),
  );

  // ---------------------------------------------------------------
  // Parsing & static assets
  // ---------------------------------------------------------------
  app.use(morgan(config.isProd ? 'combined' : 'dev'));
  app.use(express.urlencoded({ extended: true, limit: '2mb' }));
  app.use(express.json({ limit: '2mb' }));
  app.use(methodOverride('_method'));
  app.use(cookieParser());

  app.use(
    express.static(path.join(config.rootDir, 'public'), {
      maxAge: config.isProd ? '30d' : 0,
      etag: true,
    }),
  );

  // ---------------------------------------------------------------
  // Session & flash
  // ---------------------------------------------------------------
  app.set('csrfSecret', config.session.secret);

  app.use(
    session({
      name: config.session.name,
      secret: config.session.secret,
      resave: false,
      saveUninitialized: false,
      rolling: true,
      cookie: {
        httpOnly: true,
        sameSite: 'lax',
        secure: config.isProd,
        maxAge: config.session.maxAge,
      },
    }),
  );

  app.use(flash());
  app.use(csrf);

  // ---------------------------------------------------------------
  // Global rate limiting
  // ---------------------------------------------------------------
  app.use(limiters.globalLimiter);

  // ---------------------------------------------------------------
  // Locals available to every template
  // ---------------------------------------------------------------
  app.use(async (req, res, next) => {
    res.locals.app = config;
    res.locals.env = config.env;
    res.locals.C = constants;
    res.locals.fmt = fmt;
    res.locals.json = jsonUtil;

    res.locals.currentPath = req.path;
    res.locals.query = req.query || {};

    res.locals.successMessages = req.flash('success');
    res.locals.errorMessages = req.flash('error');
    res.locals.infoMessages = req.flash('info');
    res.locals.warningMessages = req.flash('warning');

    // Defaults so a view rendered from an early error still has what it needs.
    res.locals.title = config.appName;
    res.locals.metaTitle = `${config.appName} — E-commerce website design & management in Bangladesh`;
    res.locals.metaDescription =
      'WooHelperPro builds and manages high-converting e-commerce websites for Bangladeshi businesses. Order a package, pay with bKash, Nagad or Rocket, and go live.';
    res.locals.bodyClass = '';

    // Theme preference is remembered per session.
    res.locals.theme = req.session.theme || 'light';
    res.locals.lang = req.session.lang || 'en';

    // Site settings are needed in every header/footer.
    try {
      let settings = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
      if (!settings) settings = await prisma.siteSetting.create({ data: { id: 'singleton' } });
      res.locals.settings = settings;
    } catch {
      res.locals.settings = {
        siteName: config.appName, supportEmail: '', supportPhone: '', whatsappNumber: '',
        vatPercent: 5, currency: 'BDT', facebookUrl: '', youtubeUrl: '', linkedinUrl: '', officeAddress: '',
      };
    }

    // View helpers (status badges, progress bars, empty states).
    // Exposed as a local because EJS views cannot require() reliably — a
    // `require()` inside a template resolves against the EJS module, not the
    // project root, and throws at render time.
    res.locals.helpers = require('../views/partials/helpers');

    // Simple translation helper: t('Order') / t(obj, 'bn')
    res.locals.t = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') {
        const lang = res.locals.lang;
        if (lang === 'bn' && value.bn) return value.bn;
        return value.en ?? '';
      }
      return value;
    };

    next();
  });

  app.use(loadUser);

  return app;
}

module.exports = createApp;
