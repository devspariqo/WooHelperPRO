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
const compression = require('compression');

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
  // Compression
  // ---------------------------------------------------------------
  // Registered before the static handler and before any route, so HTML, CSS and
  // JS all go out gzipped. This is the single biggest PageSpeed win on a text-
  // heavy site, and it costs nothing when the client does not accept gzip.
  // Images are already compressed, so the default filter skips them.
  app.use(compression());

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
      // Uploaded media gets a long cache because filenames are content-unique
      // (random suffix), so a new upload is a new URL and can never go stale.
      // Everything else is fingerprinted by hand-editing, so a shorter window.
      setHeaders(res, filePath) {
        if (filePath.includes(`${path.sep}uploads${path.sep}`)) {
          res.setHeader('Cache-Control', config.isProd ? 'public, max-age=31536000, immutable' : 'no-cache');
        }
      },
      maxAge: config.isProd ? '30d' : 0,
      etag: true,
      // Serve pre-compressed .gz siblings when the client supports them.
      // Cheap win on repeat visits; falls through when absent.
      index: false,
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

    // Site settings are needed in every header/footer.
    try {
      let settings = await prisma.siteSetting.findUnique({ where: { id: 'singleton' } });
      if (!settings) settings = await prisma.siteSetting.create({ data: { id: 'singleton' } });
      res.locals.settings = settings;
    } catch {
      // Fallback used when the settings row cannot be read. It must carry every
      // field the layouts interpolate, because the layouts write colours and font
      // names straight into a <style> block -- a missing key would render the
      // literal string "undefined" into the CSS and break the whole page.
      res.locals.settings = {
        id: 'singleton',
        siteName: config.appName,
        tagline: '', taglineBn: '',
        supportEmail: '', supportPhone: '', whatsappNumber: '', officeAddress: '',
        bkashNumber: '', nagadNumber: '', rocketNumber: '', bankDetails: '',
        vatPercent: 5, currency: 'BDT', maintenanceMode: false,
        metaTitle: '', metaDescription: '', metaKeywords: '', metaRobots: 'index, follow',
        ogImageUrl: '', googleAnalyticsId: '', googleSiteVerification: '', twitterHandle: '',
        facebookUrl: '', youtubeUrl: '', linkedinUrl: '',
        logoUrl: '', logoAlt: '', logoHeightPx: 32, faviconUrl: '',
        logoUrlLight: '', logoUrlDark: '',
        heroImageUrl: '', heroImageAlt: '',
        primaryColor: '#7c3aed', secondaryColor: '#17141f', accentColor: '#ff6600',
        fontHeading: 'Inter', fontBody: 'Inter',
        fontHeadingBn: 'Hind Siliguri', fontBodyBn: 'Hind Siliguri',
        timezone: 'Asia/Dhaka', defaultLanguage: 'en',
        dateFormat: 'DD MMM YYYY', footerText: '',
      };
    }

    // View helpers (status badges, progress bars, empty states).
    // Exposed as a local because EJS views cannot require() reliably — a
    // `require()` inside a template resolves against the EJS module, not the
    // project root, and throws at render time.
    res.locals.helpers = require('../views/partials/helpers');

    // ---------------------------------------------------------------
    // Language
    // ---------------------------------------------------------------
    // Resolved AFTER settings, because the site-wide default lives there. A
    // visitor who explicitly switched keeps their choice in the session; everyone
    // else gets the admin's `defaultLanguage`.
    res.locals.lang = req.session.lang || res.locals.settings.defaultLanguage || 'en';
    res.locals.isBn = res.locals.lang === 'bn';

    /**
     * Pick between an English and a Bangla value.
     *
     * The Bn columns have always existed and were editable in the admin panel, but
     * nothing on the public site ever read them -- the old t() helper was defined
     * and never called once. This is the helper the views actually use:
     *
     *   tr(service.name, service.nameBn)
     *
     * Falls back to the English value when the Bangla one is blank, so a
     * half-translated record shows English rather than an empty heading.
     */
    res.locals.tr = (en, bn) => {
      const useBn = res.locals.isBn;
      if (useBn && bn !== null && bn !== undefined && String(bn).trim() !== '') return bn;
      return en === null || en === undefined ? '' : en;
    };

    // Legacy object form: t({ en: 'Order', bn: 'অর্ডার' }). Kept because a few
    // call sites and the constants file use it.
    //
    // Also the UI-string form: t('Add to cart'). The Bn database columns only ever
    // covered CONTENT (service titles, package names); the chrome -- buttons,
    // headings, labels, empty states -- was hardcoded English in the views, which
    // is why switching to Bangla left most of the page in English. The dictionary
    // in config/translations.js fills that gap. A miss returns the English key
    // unchanged rather than a placeholder, so a partial translation still reads.
    const { translate } = require('./config/translations');
    res.locals.t = (value) => {
      if (value === null || value === undefined) return '';
      if (typeof value === 'object') {
        if (res.locals.isBn && value.bn) return value.bn;
        return value.en ?? '';
      }
      return translate(value, res.locals.lang);
    };

    next();
  });

  app.use(loadUser);

  return app;
}

module.exports = createApp;
