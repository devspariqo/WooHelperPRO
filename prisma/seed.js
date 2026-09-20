'use strict';

/**
 * WooHelperPro database seeder.
 *
 * Creates a realistic Bangladeshi web-agency dataset: services, packages,
 * customers, orders at various lifecycle stages, active and past-due
 * subscriptions, paid and pending payments, tickets, leads and content.
 *
 * Idempotent: running it twice will not duplicate rows — it checks for the
 * bootstrap admin before doing anything, and every record is created with a
 * deterministic natural key (email, slug, code, order number).
 */

require('dotenv').config();

const { PrismaClient } = require('@prisma/client');
const bcrypt = require('bcryptjs');

const prisma = new PrismaClient();

const config = require('../src/config');
const sec = require('../src/utils/security');
const ids = require('../src/utils/ids');
const orderService = require('../src/services/order.service');
const subscriptionService = require('../src/services/subscription.service');
const invoiceService = require('../src/services/invoice.service');

// ------------------------------------------------------------------
// Helpers
// ------------------------------------------------------------------

const daysAgo = (n) => new Date(Date.now() - n * 86400000);
const daysAhead = (n) => new Date(Date.now() + n * 86400000);

/** Deterministic pseudo-random so re-seeding produces the same dataset. */
let seed = 20260920;
function rand() {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const randInt = (min, max) => Math.floor(rand() * (max - min + 1)) + min;
const pick = (arr) => arr[Math.floor(rand() * arr.length)];

async function main() {
  console.log('\n⚡ WooHelperPro seeder\n');
  console.log('─'.repeat(62));

  // ----------------------------------------------------------------
  // 0. Guard: has this already been seeded?
  // ----------------------------------------------------------------
  const existingAdmin = await prisma.user.findFirst({ where: { role: 'SUPER_ADMIN' } });
  if (existingAdmin) {
    console.log('⚠  Database already contains a super admin — skipping seed.');
    console.log('   To rebuild from scratch run:  npm run db:reset');
    console.log('─'.repeat(62) + '\n');
    return;
  }

  // ----------------------------------------------------------------
  // 1. Site settings
  // ----------------------------------------------------------------
  await prisma.siteSetting.upsert({
    where: { id: 'singleton' },
    create: {
      id: 'singleton',
      siteName: 'WooHelperPro',
      tagline: 'We build and manage e-commerce websites for Bangladeshi businesses.',
      taglineBn: 'আমরা বাংলাদেশের ব্যবসার জন্য ই-কমার্স ওয়েবসাইট তৈরি ও পরিচালনা করি।',
      supportEmail: 'support@woohelperpro.com',
      supportPhone: '+8809610000000',
      whatsappNumber: '8801700000000',
      officeAddress: 'Level 4, House 27, Road 11, Banani, Dhaka 1213',
      bkashNumber: '01700000000',
      nagadNumber: '01700000000',
      rocketNumber: '017000000001',
      bankDetails: 'WooHelperPro Ltd\nDutch-Bangla Bank Ltd, Banani Branch\nA/C 1234567890123\nRouting 090261726',
      vatPercent: 5,
      metaTitle: 'WooHelperPro — E-commerce website design & management in Bangladesh',
      metaDescription:
        'We design, build and manage high-converting e-commerce websites for Bangladeshi businesses. Order a package, pay with bKash, Nagad or Rocket, go live in 7 days.',
      facebookUrl: 'https://facebook.com/woohelperpro',
      youtubeUrl: 'https://youtube.com/@woohelperpro',
      linkedinUrl: 'https://linkedin.com/company/woohelperpro',
    },
    update: {},
  });
  console.log('✓ Site settings');

  // ----------------------------------------------------------------
  // 2. Staff accounts
  // ----------------------------------------------------------------
  const adminPassword = process.env.ADMIN_PASSWORD || 'WooHelper@2026';
  const demoPassword = 'Demo@1234';

  const admin = await prisma.user.create({
    data: {
      name: 'Rakib Hasan',
      email: (process.env.ADMIN_EMAIL || 'admin@woohelperpro.com').toLowerCase(),
      phone: '+8801711000001',
      passwordHash: await bcrypt.hash(adminPassword, 12),
      role: 'SUPER_ADMIN',
      status: 'ACTIVE',
      company: 'WooHelperPro',
      designation: 'Founder & CEO',
      district: 'Dhaka',
      emailVerified: true,
      kycStatus: 'VERIFIED',
    },
  });

  const staff = {};
  for (const person of [
    { key: 'manager', name: 'Nusrat Jahan', email: 'nusrat@woohelperpro.com', role: 'MANAGER', designation: 'Project Manager', district: 'Dhaka' },
    { key: 'designer', name: 'Tanvir Ahmed', email: 'tanvir@woohelperpro.com', role: 'STAFF', designation: 'Lead Designer', district: 'Dhaka' },
    { key: 'dev', name: 'Sabbir Rahman', email: 'sabbir@woohelperpro.com', role: 'STAFF', designation: 'Full-stack Developer', district: 'Gazipur' },
    { key: 'support', name: 'Farhana Akter', email: 'farhana@woohelperpro.com', role: 'SUPPORT', designation: 'Customer Support Lead', district: 'Dhaka' },
    { key: 'accounts', name: 'Imran Kabir', email: 'imran@woohelperpro.com', role: 'ADMIN', designation: 'Finance & Accounts', district: 'Chattogram' },
  ]) {
    staff[person.key] = await prisma.user.create({
      data: {
        name: person.name,
        email: person.email,
        phone: `+88017110000${randInt(10, 99)}`,
        passwordHash: await bcrypt.hash(demoPassword, 12),
        role: person.role,
        status: 'ACTIVE',
        company: 'WooHelperPro',
        designation: person.designation,
        district: person.district,
        emailVerified: true,
      },
    });
  }
  console.log(`✓ Staff accounts (${Object.keys(staff).length + 1})`);

  // ----------------------------------------------------------------
  // 3. Service categories
  // ----------------------------------------------------------------
  const categoryDefs = [
    { name: 'E-commerce Websites', nameBn: 'ই-কমার্স ওয়েবসাইট', slug: 'ecommerce', icon: 'cart', sortOrder: 1 },
    { name: 'Landing Pages', nameBn: 'ল্যান্ডিং পেজ', slug: 'landing-pages', icon: 'layout', sortOrder: 2 },
    { name: 'Payments & Logistics', nameBn: 'পেমেন্ট ও লজিস্টিকস', slug: 'integrations', icon: 'plug', sortOrder: 3 },
    { name: 'Marketing & Growth', nameBn: 'মার্কেটিং ও গ্রোথ', slug: 'marketing', icon: 'megaphone', sortOrder: 4 },
    { name: 'Design & Branding', nameBn: 'ডিজাইন ও ব্র্যান্ডিং', slug: 'design', icon: 'palette', sortOrder: 5 },
    { name: 'Care & Maintenance', nameBn: 'সাপোর্ট ও মেইনটেন্যান্স', slug: 'maintenance', icon: 'wrench', sortOrder: 6 },
  ];

  const categories = {};
  for (const def of categoryDefs) {
    categories[def.slug] = await prisma.serviceCategory.create({ data: def });
  }
  console.log(`✓ Service categories (${categoryDefs.length})`);

  // ----------------------------------------------------------------
  // 4. Services
  // ----------------------------------------------------------------
  const serviceDefs = [
    {
      title: 'Complete E-commerce Website',
      titleBn: 'সম্পূর্ণ ই-কমার্স ওয়েবসাইট',
      slug: 'ecommerce-website',
      categoryId: categories.ecommerce.id,
      icon: 'cart',
      shortDesc: 'A full online store with product management, cart, checkout and delivery integration — ready to sell from day one.',
      shortDescBn: 'প্রোডাক্ট ম্যানেজমেন্ট, কার্ট, চেকআউট ও ডেলিভারি ইন্টিগ্রেশনসহ সম্পূর্ণ অনলাইন স্টোর।',
      description: 'Our flagship build. You get a fast, mobile-first storefront, an admin panel your staff can actually operate, bKash/Nagad/Rocket checkout, cash-on-delivery with fake-order screening, and one-click courier booking with Pathao and Steadfast. We migrate your existing products, set up Facebook Pixel and GA4 with server-side tracking, and train your team before handover.',
      descriptionBn: 'আমাদের প্রধান সেবা। আপনি পাবেন দ্রুতগতির মোবাইল-ফ্রেন্ডলি স্টোরফ্রন্ট, সহজে ব্যবহারযোগ্য অ্যাডমিন প্যানেল, বিকাশ/নগদ/রকেট চেকআউট, ক্যাশ অন ডেলিভারি, ফেক অর্ডার চেক এবং এক ক্লিকে কুরিয়ার বুকিং।',
      basePrice: 35000,
      deliveryDays: 14,
      isFeatured: true,
      features: [
        'Custom responsive storefront design',
        'Unlimited products with variants (size, colour)',
        'bKash, Nagad, Rocket & SSLCommerz checkout',
        'Cash on delivery with fake-order screening',
        'Pathao & Steadfast courier integration',
        'Order management with status workflow',
        'Inventory with low-stock alerts',
        'Admin panel with staff roles',
        'Facebook Pixel + GA4 (browser & server-side)',
        'On-page SEO, sitemap & schema markup',
        'Coupon and campaign management',
        '1 hour of staff training + documentation',
      ],
      featuresBn: [
        'কাস্টম রেসপন্সিভ স্টোরফ্রন্ট ডিজাইন',
        'ভ্যারিয়েন্টসহ আনলিমিটেড প্রোডাক্ট',
        'বিকাশ, নগদ, রকেট ও এসএসএলকমার্জ চেকআউট',
        'ফেক অর্ডার চেকসহ ক্যাশ অন ডেলিভারি',
        'পাঠাও ও স্টেডফাস্ট কুরিয়ার ইন্টিগ্রেশন',
        'স্ট্যাটাস ওয়ার্কফ্লোসহ অর্ডার ম্যানেজমেন্ট',
        'স্টক ম্যানেজমেন্ট ও লো-স্টক অ্যালার্ট',
        'স্টাফ রোলসহ অ্যাডমিন প্যানেল',
      ],
      sortOrder: 1,
    },
    {
      title: 'Single-Product Landing Page',
      titleBn: 'সিঙ্গেল প্রোডাক্ট ল্যান্ডিং পেজ',
      slug: 'landing-page',
      categoryId: categories['landing-pages'].id,
      icon: 'layout',
      shortDesc: 'A high-converting one-page funnel for a single product, with order form, reviews and a countdown offer.',
      shortDescBn: 'একটি প্রোডাক্টের জন্য উচ্চ-কনভার্সন ওয়ান-পেজ ফানেল, অর্ডার ফর্ম ও কাউন্টডাউন অফারসহ।',
      description: 'Built for Facebook and TikTok ad traffic. Hero with product video, trust badges, review section, quantity offers, delivery charge per district, and a one-click order form that supports cash on delivery. Loads in under a second so your ad spend is not wasted on bounce.',
      descriptionBn: 'ফেসবুক ও টিকটক অ্যাড ট্রাফিকের জন্য তৈরি। প্রোডাক্ট ভিডিও, ট্রাস্ট ব্যাজ, রিভিউ সেকশন, পরিমাণভিত্তিক অফার এবং এক ক্লিক অর্ডার ফর্ম।',
      basePrice: 12000,
      deliveryDays: 5,
      isFeatured: true,
      features: [
        'Conversion-focused single-page design',
        'Product video or image gallery hero',
        'One-click order form with COD support',
        'District-wise delivery charge rules',
        'Bundle / quantity discount offers',
        'Customer review section',
        'Countdown timer for limited offers',
        'Meta Pixel purchase event tracking',
        'Mobile-first, sub-1s load time',
        'Order notification to your phone',
      ],
      featuresBn: [
        'কনভার্সন-ফোকাসড সিঙ্গেল পেজ ডিজাইন',
        'প্রোডাক্ট ভিডিও বা গ্যালারি হিরো',
        'সিওডি সাপোর্টসহ এক ক্লিক অর্ডার ফর্ম',
        'জেলা অনুযায়ী ডেলিভারি চার্জ',
        'পরিমাণভিত্তিক ডিসকাউন্ট অফার',
        'কাস্টমার রিভিউ সেকশন',
      ],
      sortOrder: 2,
    },
    {
      title: 'Payment Gateway Integration',
      titleBn: 'পেমেন্ট গেটওয়ে ইন্টিগ্রেশন',
      slug: 'payment-gateway-integration',
      categoryId: categories.integrations.id,
      icon: 'plug',
      shortDesc: 'Connect bKash, Nagad, Rocket and card payments to your existing website, with automatic verification.',
      shortDescBn: 'আপনার বর্তমান ওয়েবসাইটে বিকাশ, নগদ, রকেট ও কার্ড পেমেন্ট যুক্ত করুন, স্বয়ংক্রিয় ভেরিফিকেশনসহ।',
      description: 'We handle the merchant onboarding paperwork, sandbox testing and live go-live for bKash Merchant, Nagad, Rocket and SSLCommerz. Includes automatic payment verification, failed-payment recovery, and reconciliation reports so your accounts team stops chasing TrxIDs by hand.',
      descriptionBn: 'বিকাশ মার্চেন্ট, নগদ, রকেট ও এসএসএলকমার্জের জন্য মার্চেন্ট অনবোর্ডিং থেকে লাইভ গোলাইভ পর্যন্ত আমরা সামলাই।',
      basePrice: 15000,
      deliveryDays: 7,
      features: [
        'bKash Merchant account integration',
        'Nagad merchant integration',
        'Rocket & Upay integration',
        'SSLCommerz card and net-banking checkout',
        'Automatic payment verification',
        'Failed payment retry flow',
        'Refund handling workflow',
        'Daily reconciliation report',
        'Sandbox testing before go-live',
      ],
      featuresBn: [
        'বিকাশ মার্চেন্ট অ্যাকাউন্ট ইন্টিগ্রেশন',
        'নগদ মার্চেন্ট ইন্টিগ্রেশন',
        'রকেট ও উপায় ইন্টিগ্রেশন',
        'এসএসএলকমার্জ কার্ড চেকআউট',
        'স্বয়ংক্রিয় পেমেন্ট ভেরিফিকেশন',
      ],
      sortOrder: 3,
    },
    {
      title: 'Courier & Logistics Integration',
      titleBn: 'কুরিয়ার ও লজিস্টিকস ইন্টিগ্রেশন',
      slug: 'courier-integration',
      categoryId: categories.integrations.id,
      icon: 'truck',
      shortDesc: 'Book Pathao, Steadfast, RedX and e-Courier deliveries from your order screen with automatic tracking.',
      shortDescBn: 'অর্ডার স্ক্রিন থেকে পাঠাও, স্টেডফাস্ট, রেডএক্স ও ই-কুরিয়ার ডেলিভারি বুক করুন, স্বয়ংক্রিয় ট্র্যাকিংসহ।',
      description: 'One-click consignment booking, bulk dispatch for high-volume days, printable labels and packing slips, and automatic status sync back into your order records. Includes a courier-performance report so you know which carrier actually delivers in which district.',
      descriptionBn: 'এক ক্লিকে কনসাইনমেন্ট বুকিং, বাল্ক ডিসপ্যাচ, প্রিন্টেবল লেবেল এবং স্বয়ংক্রিয় স্ট্যাটাস সিঙ্ক।',
      basePrice: 10000,
      deliveryDays: 5,
      features: [
        'Pathao Merchant API integration',
        'Steadfast integration',
        'RedX and e-Courier support',
        'Bulk consignment booking',
        'Printable labels and packing slips',
        'Automatic tracking status sync',
        'COD collection reconciliation',
        'Courier performance by district',
      ],
      featuresBn: [
        'পাঠাও মার্চেন্ট এপিআই ইন্টিগ্রেশন',
        'স্টেডফাস্ট ইন্টিগ্রেশন',
        'রেডএক্স ও ই-কুরিয়ার সাপোর্ট',
        'বাল্ক কনসাইনমেন্ট বুকিং',
        'স্বয়ংক্রিয় ট্র্যাকিং স্ট্যাটাস সিঙ্ক',
      ],
      sortOrder: 4,
    },
    {
      title: 'SEO & Content Setup',
      titleBn: 'এসইও ও কন্টেন্ট সেটআপ',
      slug: 'seo-setup',
      categoryId: categories.marketing.id,
      icon: 'search',
      shortDesc: 'Rank for the searches your customers actually make — technical SEO, content structure and local listings.',
      shortDescBn: 'আপনার কাস্টমাররা যা সার্চ করে তার জন্য র‍্যাংক করুন — টেকনিক্যাল এসইও ও কন্টেন্ট স্ট্রাকচার।',
      description: 'Technical audit and fixes, keyword research for the Bangladeshi market (Bangla and English search terms), product and category page optimisation, schema markup, XML sitemap, Google Business Profile setup, and a content calendar your team can follow.',
      descriptionBn: 'টেকনিক্যাল অডিট, বাংলাদেশি মার্কেটের জন্য কিওয়ার্ড রিসার্চ (বাংলা ও ইংরেজি), প্রোডাক্ট পেজ অপটিমাইজেশন ও কন্টেন্ট ক্যালেন্ডার।',
      basePrice: 18000,
      deliveryDays: 10,
      features: [
        'Full technical SEO audit',
        'Bangla + English keyword research',
        'On-page optimisation for 20 pages',
        'Schema markup and rich snippets',
        'XML sitemap and robots.txt',
        'Google Business Profile setup',
        'Core Web Vitals optimisation',
        '3-month content calendar',
        'Monthly ranking report',
      ],
      featuresBn: [
        'সম্পূর্ণ টেকনিক্যাল এসইও অডিট',
        'বাংলা ও ইংরেজি কিওয়ার্ড রিসার্চ',
        '২০টি পেজের অন-পেজ অপটিমাইজেশন',
        'স্কিমা মার্কআপ ও রিচ স্নিপেট',
        'গুগল বিজনেস প্রোফাইল সেটআপ',
      ],
      sortOrder: 5,
    },
    {
      title: 'Facebook & TikTok Ads Management',
      titleBn: 'ফেসবুক ও টিকটক অ্যাডস ম্যানেজমেন্ট',
      slug: 'ads-management',
      categoryId: categories.marketing.id,
      icon: 'megaphone',
      shortDesc: 'Monthly ad campaigns run by people who understand Bangladeshi buying behaviour and COD drop-off.',
      shortDescBn: 'বাংলাদেশি ক্রেতাদের আচরণ বুঝে মাসিক অ্যাড ক্যাম্পেইন পরিচালনা।',
      description: 'Creative production, audience research, campaign structure, daily optimisation and weekly reporting. We optimise for confirmed delivered orders, not vanity clicks — so your cost per delivered sale is what improves. Ad spend is billed separately to you directly.',
      descriptionBn: 'ক্রিয়েটিভ প্রোডাকশন, অডিয়েন্স রিসার্চ, ক্যাম্পেইন স্ট্রাকচার ও সাপ্তাহিক রিপোর্টিং। আমরা কনফার্মড ডেলিভারড অর্ডারের জন্য অপটিমাইজ করি।',
      basePrice: 12000,
      deliveryDays: 3,
      features: [
        'Campaign strategy and structure',
        '8 ad creatives per month',
        'Audience research and testing',
        'Daily optimisation and bid management',
        'Pixel and conversion API events',
        'Retargeting and lookalike audiences',
        'Weekly performance report',
        'Cost per delivered order tracking',
      ],
      featuresBn: [
        'ক্যাম্পেইন স্ট্র্যাটেজি ও স্ট্রাকচার',
        'মাসে ৮টি অ্যাড ক্রিয়েটিভ',
        'অডিয়েন্স রিসার্চ ও টেস্টিং',
        'দৈনিক অপটিমাইজেশন',
        'সাপ্তাহিক পারফরম্যান্স রিপোর্ট',
      ],
      sortOrder: 6,
    },
    {
      title: 'Brand Identity & Logo Design',
      titleBn: 'ব্র্যান্ড আইডেন্টিটি ও লোগো ডিজাইন',
      slug: 'brand-identity',
      categoryId: categories.design.id,
      icon: 'palette',
      shortDesc: 'Logo, colour system, typography and packaging design that makes a small brand look established.',
      shortDescBn: 'লোগো, কালার সিস্টেম, টাইপোগ্রাফি ও প্যাকেজিং ডিজাইন।',
      description: 'Three logo concepts, refinement on your chosen direction, full asset pack (SVG, PNG, favicon, social profile sizes), brand colour and typography system, packaging mockups, and a one-page brand guideline your printer and designer can follow.',
      descriptionBn: 'তিনটি লোগো কনসেপ্ট, অ্যাসেট প্যাক, ব্র্যান্ড কালার ও টাইপোগ্রাফি সিস্টেম, প্যাকেজিং মকআপ এবং ব্র্যান্ড গাইডলাইন।',
      basePrice: 9000,
      deliveryDays: 7,
      features: [
        '3 initial logo concepts',
        'Unlimited refinement on chosen concept',
        'Full asset pack (SVG, PNG, favicon)',
        'Social media profile kit',
        'Brand colour and typography system',
        'Packaging and label mockups',
        'One-page brand guideline document',
      ],
      featuresBn: [
        '৩টি লোগো কনসেপ্ট',
        'সব ফরম্যাটে অ্যাসেট প্যাক (SVG, PNG)',
        'সোশ্যাল মিডিয়া প্রোফাইল কিট',
        'ব্র্যান্ড কালার ও টাইপোগ্রাফি সিস্টেম',
        'প্যাকেজিং মকআপ',
      ],
      sortOrder: 7,
    },
    {
      title: 'Website Care & Maintenance',
      titleBn: 'ওয়েবসাইট কেয়ার ও মেইনটেন্যান্স',
      slug: 'website-maintenance',
      categoryId: categories.maintenance.id,
      icon: 'wrench',
      shortDesc: 'Monthly hosting, security, backups, content updates and priority support so your site never goes down.',
      shortDescBn: 'মাসিক হোস্টিং, সিকিউরিটি, ব্যাকআপ, কন্টেন্ট আপডেট ও প্রায়োরিটি সাপোর্ট।',
      description: 'Managed BDIX hosting with SSL, daily off-site backups, uptime monitoring, security patching, monthly performance tuning, and a support queue with a four-hour response target. Includes up to four hours of content or feature changes each month so you do not need to keep a developer on retainer.',
      descriptionBn: 'এসএসএলসহ ম্যানেজড বিডিআইএক্স হোস্টিং, দৈনিক অফসাইট ব্যাকআপ, আপটাইম মনিটরিং, সিকিউরিটি প্যাচিং এবং ৪ ঘণ্টার রেসপন্স টার্গেটসহ সাপোর্ট।',
      basePrice: 0,
      deliveryDays: 1,
      isFeatured: true,
      features: [
        'BDIX shared or VPS hosting',
        'SSL certificate renewal',
        'Daily off-site backup (30-day retention)',
        'Uptime monitoring with SMS alerts',
        'Security patching and malware scan',
        'Monthly performance tuning',
        '4 hours of content changes per month',
        '4-hour priority response SLA',
        'Monthly health report',
      ],
      featuresBn: [
        'বিডিআইএক্স শেয়ার্ড বা ভিপিএস হোস্টিং',
        'এসএসএল সার্টিফিকেট রিনিউ',
        'দৈনিক অফসাইট ব্যাকআপ',
        'আপটাইম মনিটরিং ও অ্যালার্ট',
        'মাসে ৪ ঘণ্টা কন্টেন্ট পরিবর্তন',
      ],
      sortOrder: 8,
    },
  ];

  const services = {};
  for (const def of serviceDefs) {
    services[def.slug] = await prisma.service.create({
      data: {
        ...def,
        features: JSON.stringify(def.features || []),
        featuresBn: JSON.stringify(def.featuresBn || []),
        status: 'ACTIVE',
        metaTitle: `${def.title} — WooHelperPro Bangladesh`,
        metaDescription: def.shortDesc,
      },
    });
  }
  console.log(`✓ Services (${serviceDefs.length})`);

  // ----------------------------------------------------------------
  // 5. Packages
  // ----------------------------------------------------------------
  const packageDefs = [
    {
      name: 'Starter Landing Page',
      slug: 'starter-landing-page',
      serviceId: services['landing-page'].id,
      tier: 'STARTER',
      tagline: 'One product, one page, built to convert ad traffic.',
      taglineBn: 'একটি প্রোডাক্ট, একটি পেজ, অ্যাড ট্রাফিক কনভার্ট করার জন্য তৈরি।',
      price: 12000,
      setupFee: 0,
      monthlyPrice: 1500,
      yearlyPrice: 15000,
      discountPercent: 0,
      billingCycle: 'ONE_TIME',
      features: [
        'Single-page conversion design',
        'Custom mobile-first layout',
        'One-click order form with COD',
        'District-wise delivery charge setup',
        'Meta Pixel purchase tracking',
        'Free SSL certificate',
        '3 months support',
        'Basic SEO setup',
      ],
      featuresBn: ['সিঙ্গেল পেজ ডিজাইন', 'মোবাইল-ফার্স্ট লেআউট', 'সিওডি অর্ডার ফর্ম', 'মেটা পিক্সেল ট্র্যাকিং'],
      excluded: ['Full e-commerce catalogue', 'Payment gateway', 'Multi-vendor support', 'Mobile app'],
      excludedBn: ['সম্পূর্ণ ই-কমার্স ক্যাটালগ', 'পেমেন্ট গেটওয়ে'],
      revisions: 2,
      deliveryDays: 5,
      supportMonths: 3,
      pagesIncluded: 1,
      productsLimit: 3,
      staffLimit: 1,
      isPopular: false,
      sortOrder: 1,
    },
    {
      name: 'Basic Store',
      slug: 'basic-store',
      serviceId: services['ecommerce-website'].id,
      tier: 'BASIC',
      tagline: 'A real online store for a growing Facebook business.',
      taglineBn: 'বাড়তে থাকা ফেসবুক ব্যবসার জন্য একটি সত্যিকারের অনলাইন স্টোর।',
      price: 35000,
      setupFee: 2000,
      monthlyPrice: 3000,
      yearlyPrice: 30000,
      discountPercent: 15,
      billingCycle: 'ONE_TIME',
      features: [
        'Custom responsive storefront',
        'Up to 200 products with variants',
        'Cash on delivery + manual bKash',
        'Order management dashboard',
        'Inventory with low-stock alerts',
        'Basic SEO and sitemap',
        'Facebook Pixel setup',
        '1 admin + 2 staff accounts',
        '3 months free support',
        'BDIX hosting for 6 months',
      ],
      featuresBn: ['কাস্টম স্টোরফ্রন্ট', '২০০ প্রোডাক্ট পর্যন্ত', 'সিওডি ও ম্যানুয়াল বিকাশ', 'অর্ডার ম্যানেজমেন্ট'],
      excluded: ['bKash/Nagad automatic gateway', 'Courier API integration', 'Multi-vendor system', 'Mobile app', 'Ads management'],
      excludedBn: ['বিকাশ/নগদ অটোমেটিক গেটওয়ে', 'কুরিয়ার এপিআই ইন্টিগ্রেশন'],
      revisions: 3,
      deliveryDays: 10,
      supportMonths: 3,
      hostingMonths: 6,
      pagesIncluded: 12,
      productsLimit: 200,
      staffLimit: 3,
      isPopular: true,
      sortOrder: 2,
    },
    {
      name: 'Professional Store',
      slug: 'professional-store',
      serviceId: services['ecommerce-website'].id,
      tier: 'PROFESSIONAL',
      tagline: 'Payment gateways, courier integration and fake-order protection.',
      taglineBn: 'পেমেন্ট গেটওয়ে, কুরিয়ার ইন্টিগ্রেশন ও ফেক অর্ডার প্রোটেকশন।',
      price: 65000,
      setupFee: 3000,
      monthlyPrice: 5500,
      yearlyPrice: 55000,
      discountPercent: 20,
      billingCycle: 'ONE_TIME',
      features: [
        'Everything in Basic Store',
        'Unlimited products and categories',
        'bKash, Nagad, Rocket & SSLCommerz checkout',
        'Pathao + Steadfast courier integration',
        'Fake order screening with risk score',
        'Incomplete order recovery system',
        'GA4 + Facebook Pixel server-side tracking',
        'Advanced SEO and schema markup',
        'Coupon and campaign management',
        'Up to 8 staff accounts with roles',
        '6 months free support',
        'BDIX hosting for 12 months',
      ],
      featuresBn: ['বেসিক স্টোরের সবকিছু', 'আনলিমিটেড প্রোডাক্ট', 'সব পেমেন্ট গেটওয়ে', 'কুরিয়ার ইন্টিগ্রেশন'],
      excluded: ['Multi-vendor marketplace', 'Mobile app', 'Ads management', 'Custom ERP integration'],
      excludedBn: ['মাল্টি-ভেন্ডর মার্কেটপ্লেস', 'মোবাইল অ্যাপ'],
      revisions: 5,
      deliveryDays: 14,
      supportMonths: 6,
      hostingMonths: 12,
      pagesIncluded: 25,
      productsLimit: 0,
      staffLimit: 8,
      isPopular: true,
      sortOrder: 3,
    },
    {
      name: 'Business Store',
      slug: 'business-store',
      serviceId: services['ecommerce-website'].id,
      tier: 'BUSINESS',
      tagline: 'Multi-vendor marketplace with POS and full team management.',
      taglineBn: 'পিওএস ও টিম ম্যানেজমেন্টসহ মাল্টি-ভেন্ডর মার্কেটপ্লেস।',
      price: 145000,
      setupFee: 5000,
      monthlyPrice: 12000,
      yearlyPrice: 120000,
      discountPercent: 25,
      billingCycle: 'ONE_TIME',
      features: [
        'Everything in Professional Store',
        'Multi-vendor marketplace with commissions',
        'Vendor dashboards and settlement reports',
        'Point-of-sale (POS) module',
        'Warehouse and multi-location stock',
        'Expense tracking and profit reporting',
        'Advanced role and permission system',
        'Telegram order notifications',
        'Multi-channel sales management',
        'Priority support (4-hour SLA)',
        '12 months free support',
        'Dedicated project manager',
      ],
      featuresBn: ['প্রফেশনাল স্টোরের সবকিছু', 'মাল্টি-ভেন্ডর মার্কেটপ্লেস', 'পিওএস মডিউল', 'অ্যাডভান্সড রোল সিস্টেম'],
      excluded: ['Native mobile app', 'Custom ERP integration'],
      excludedBn: ['নেটিভ মোবাইল অ্যাপ'],
      revisions: 8,
      deliveryDays: 30,
      supportMonths: 12,
      hostingMonths: 12,
      pagesIncluded: 50,
      productsLimit: 0,
      staffLimit: 25,
      isPopular: false,
      sortOrder: 4,
    },
    {
      name: 'Care Plan — Monthly',
      slug: 'care-plan-monthly',
      serviceId: services['website-maintenance'].id,
      tier: 'BASIC',
      tagline: 'Hosting, security, backups and 4 hours of changes every month.',
      taglineBn: 'হোস্টিং, সিকিউরিটি, ব্যাকআপ এবং প্রতি মাসে ৪ ঘণ্টা পরিবর্তনের সুযোগ।',
      price: 0,
      setupFee: 0,
      monthlyPrice: 3500,
      yearlyPrice: 35000,
      discountPercent: 17,
      billingCycle: 'MONTHLY',
      features: [
        'BDIX managed hosting + SSL',
        'Daily off-site backups (30 days)',
        'Uptime monitoring and SMS alerts',
        'Security patching and malware scanning',
        'Monthly performance tuning',
        '4 hours of content changes per month',
        '4-hour priority support response',
        'Monthly health report',
      ],
      featuresBn: ['বিডিআইএক্স হোস্টিং ও এসএসএল', 'দৈনিক ব্যাকআপ', 'আপটাইম মনিটরিং', 'মাসে ৪ ঘণ্টা কন্টেন্ট পরিবর্তন'],
      excluded: ['New feature development', 'Ad creative production'],
      excludedBn: ['নতুন ফিচার ডেভেলপমেন্ট', 'অ্যাড ক্রিয়েটিভ'],
      revisions: 0,
      deliveryDays: 1,
      supportMonths: 1,
      pagesIncluded: 0,
      productsLimit: 0,
      staffLimit: 0,
      isPopular: false,
      isRecurring: true,
      sortOrder: 5,
    },
    {
      name: 'Growth Plan — Monthly',
      slug: 'growth-plan-monthly',
      serviceId: services['ads-management'].id,
      tier: 'PROFESSIONAL',
      tagline: 'Everything in Care Plan plus SEO and ad management.',
      taglineBn: 'কেয়ার প্ল্যানের সবকিছু এবং অতিরিক্ত এসইও ও অ্যাড ম্যানেজমেন্ট।',
      price: 0,
      setupFee: 0,
      monthlyPrice: 9500,
      yearlyPrice: 95000,
      discountPercent: 17,
      billingCycle: 'MONTHLY',
      features: [
        'Everything in Care Plan — Monthly',
        'Monthly SEO optimisation and reporting',
        '8 ad creatives produced per month',
        'Facebook & TikTok campaign management',
        'Audience research and retargeting',
        'Weekly performance reporting',
        'Conversion rate optimisation',
        'Quarterly strategy call',
      ],
      featuresBn: ['কেয়ার প্ল্যানের সবকিছু', 'মাসিক এসইও অপটিমাইজেশন', 'মাসে ৮টি অ্যাড ক্রিয়েটিভ', 'ক্যাম্পেইন ম্যানেজমেন্ট'],
      excluded: ['Ad spend budget (billed separately)', 'New feature development'],
      excludedBn: ['অ্যাড স্পেন্ড বাজেট (আলাদা বিল)'],
      revisions: 0,
      deliveryDays: 1,
      supportMonths: 1,
      pagesIncluded: 0,
      productsLimit: 0,
      staffLimit: 0,
      isPopular: true,
      isRecurring: true,
      sortOrder: 6,
    },
  ];

  const packages = {};
  for (const def of packageDefs) {
    packages[def.slug] = await prisma.package.create({
      data: {
        ...def,
        features: JSON.stringify(def.features || []),
        featuresBn: JSON.stringify(def.featuresBn || []),
        excluded: JSON.stringify(def.excluded || []),
        excludedBn: JSON.stringify(def.excludedBn || []),
        isActive: true,
        isRecurring: def.isRecurring || false,
      },
    });
  }
  console.log(`✓ Packages (${packageDefs.length})`);

  // ----------------------------------------------------------------
  // 6. Coupons
  // ----------------------------------------------------------------
  await prisma.coupon.createMany({
    data: [
      {
        code: 'EID2026',
        description: 'Eid campaign — 10% off any website package',
        discountType: 'PERCENT',
        discountValue: 10,
        minOrder: 20000,
        maxUses: 100,
        usedCount: 23,
        appliesTo: 'PACKAGE',
        isActive: true,
        expiresAt: daysAhead(45),
      },
      {
        code: 'STARTBD5000',
        description: '৳5,000 off your first website build',
        discountType: 'FIXED',
        discountValue: 5000,
        minOrder: 35000,
        maxUses: 50,
        usedCount: 11,
        appliesTo: 'PACKAGE',
        isActive: true,
        expiresAt: daysAhead(90),
      },
      {
        code: 'CARE3FREE',
        description: '3 months of Care Plan free with any annual subscription',
        discountType: 'PERCENT',
        discountValue: 25,
        minOrder: 0,
        maxUses: 0,
        usedCount: 7,
        appliesTo: 'SUBSCRIPTION',
        isActive: true,
      },
      {
        code: 'LAUNCH10',
        description: 'Launch offer — 10% off, expired',
        discountType: 'PERCENT',
        discountValue: 10,
        minOrder: 0,
        maxUses: 200,
        usedCount: 200,
        appliesTo: 'ALL',
        isActive: false,
        expiresAt: daysAgo(20),
      },
    ],
  });
  console.log('✓ Coupons (4)');

  // ----------------------------------------------------------------
  // 7. Customers
  // ----------------------------------------------------------------
  const customerDefs = [
    { name: 'Shahidul Islam', email: 'shahidul@fashionhub.com.bd', company: 'Fashion Hub BD', district: 'Dhaka', business: 'Fashion & Clothing' },
    { name: 'Mehjabin Chowdhury', email: 'mehjabin@glowbeauty.bd', company: 'Glow Beauty Care', district: 'Dhaka', business: 'Cosmetics & Beauty' },
    { name: 'Arif Hossain', email: 'arif@gadgetbari.com', company: 'Gadget Bari', district: 'Chattogram', business: 'Gadgets & Electronics' },
    { name: 'Sultana Razia', email: 'sultana@organichut.com', company: 'Organic Hut', district: 'Sylhet', business: 'Organic Food & Grocery' },
    { name: 'Kamrul Hasan', email: 'kamrul@islamicstorebd.com', company: 'Islamic Store BD', district: 'Dhaka', business: 'Islamic Products' },
    { name: 'Nadia Sultana', email: 'nadia@homedecorbd.com', company: 'Home Decor Bangladesh', district: 'Rajshahi', business: 'Home Decor & Furniture' },
    { name: 'Rezaul Karim', email: 'rezaul@kitabghor.com', company: 'Kitab Ghor', district: 'Dhaka', business: 'Books & Stationery' },
    { name: 'Tasnim Rahman', email: 'tasnim@fitlifebd.com', company: 'FitLife Supplements', district: 'Khulna', business: 'Fitness & Supplements' },
    { name: 'Mohammad Ali', email: 'ali@chittagongit.com', company: 'Chittagong IT Solutions', district: 'Chattogram', business: 'Gadgets & Electronics' },
    { name: 'Rumana Begum', email: 'rumana@kidszonebd.com', company: 'Kids Zone BD', district: 'Gazipur', business: 'Kids & Toys' },
    { name: 'Jahangir Alam', email: 'jahangir@pharmacyplusbd.com', company: 'Pharmacy Plus', district: 'Barishal', business: 'Pharmacy & Health' },
    { name: 'Shirin Akter', email: 'shirin@giftgallerybd.com', company: 'Gift Gallery BD', district: 'Cumilla', business: 'Gift Items' },
  ];

  const customers = [];
  for (const def of customerDefs) {
    const created = await prisma.user.create({
      data: {
        name: def.name,
        email: def.email,
        phone: sec.normalizeBdPhone(`017${randInt(10000000, 99999999)}`),
        passwordHash: await bcrypt.hash(demoPassword, 12),
        role: 'CUSTOMER',
        status: 'ACTIVE',
        company: def.company,
        district: def.district,
        address: `House ${randInt(1, 120)}, Road ${randInt(1, 30)}, ${def.district}`,
        emailVerified: true,
        kycStatus: pick(['PENDING', 'VERIFIED', 'VERIFIED', 'NOT_SUBMITTED']),
        createdAt: daysAgo(randInt(20, 400)),
      },
    });
    customers.push(created);
  }
  console.log(`✓ Customers (${customers.length})`);

  // ----------------------------------------------------------------
  // 8. Orders across the full lifecycle
  // ----------------------------------------------------------------
  const orderPlan = [
    { cust: 0, pkg: 'professional-store', status: 'DELIVERED', daysOld: 240, paid: 'full', progress: 100 },
    { cust: 1, pkg: 'basic-store', status: 'DELIVERED', daysOld: 180, paid: 'full', progress: 100 },
    { cust: 2, pkg: 'business-store', status: 'DELIVERED', daysOld: 150, paid: 'full', progress: 100 },
    { cust: 3, pkg: 'professional-store', status: 'LAUNCHED_IN_PROGRESS', daysOld: 110, paid: 'partial', progress: 45 },
    { cust: 4, pkg: 'basic-store', status: 'COMPLETED', daysOld: 95, paid: 'full', progress: 90 },
    { cust: 5, pkg: 'starter-landing-page', status: 'DELIVERED', daysOld: 80, paid: 'full', progress: 100 },
    { cust: 6, pkg: 'professional-store', status: 'IN_PROGRESS', daysOld: 45, paid: 'partial', progress: 50 },
    { cust: 7, pkg: 'basic-store', status: 'CLIENT_REVIEW', daysOld: 30, paid: 'full', progress: 70 },
    { cust: 8, pkg: 'business-store', status: 'IN_PROGRESS', daysOld: 25, paid: 'partial', progress: 35 },
    { cust: 9, pkg: 'starter-landing-page', status: 'REVISION', daysOld: 18, paid: 'full', progress: 75 },
    { cust: 10, pkg: 'professional-store', status: 'AWAITING_PAYMENT', daysOld: 9, paid: 'none', progress: 0 },
    { cust: 11, pkg: 'starter-landing-page', status: 'AWAITING_PAYMENT', daysOld: 6, paid: 'none', progress: 0 },
    { cust: 1, pkg: 'care-plan-monthly', status: 'PAYMENT_VERIFIED', daysOld: 4, paid: 'partial', progress: 15 },
    { cust: 2, pkg: 'professional-store', status: 'IN_REVIEW', daysOld: 3, paid: 'none', progress: 5 },
    { cust: 0, pkg: 'starter-landing-page', status: 'AWAITING_PAYMENT', daysOld: 1, paid: 'none', progress: 0 },
  ];

  const createdOrders = [];

  for (const plan of orderPlan) {
    const customer = customers[plan.cust];
    const pkg = packages[plan.pkg];
    const createdAt = daysAgo(plan.daysOld);

    const subtotal = pkg.price + pkg.setupFee;
    const discount = pkg.discountPercent > 0 ? Math.round((subtotal * pkg.discountPercent) / 100) : 0;
    const taxable = subtotal - discount;
    const tax = Math.round(taxable * 0.05);
    const total = taxable + tax;

    const statusMap = {
      LAUNCHED_IN_PROGRESS: 'IN_PROGRESS',
    };
    const finalStatus = statusMap[plan.status] || plan.status;

    let paidAmount = 0;
    let paymentStatus = 'UNPAID';
    if (plan.paid === 'full') {
      paidAmount = total;
      paymentStatus = 'PAID';
    } else if (plan.paid === 'partial') {
      paidAmount = Math.round(total * 0.4);
      paymentStatus = 'PARTIAL';
    }

    const seq = createdOrders.length + 1;
    const orderNumber = ids.build('ORD', seq);

    const order = await prisma.order.create({
      data: {
        orderNumber,
        userId: customer.id,
        packageId: pkg.id,
        serviceId: pkg.serviceId,
        projectName: `${customer.company} — ${pkg.name}`,
        projectType: pkg.name.includes('Landing') ? 'Landing Page' : 'E-commerce Website',
        businessName: customer.company,
        businessType: customerDefs[plan.cust].business,
        websiteGoal: 'Launch an online store that handles cash-on-delivery orders without manual tracking in spreadsheets.',
        referenceUrls: pick(['https://daraz.com.bd', 'https://pickaboo.com', 'https://chaldal.com', '']),
        selectedPages: JSON.stringify(['Home', 'Shop / Category', 'Product detail', 'Cart & Checkout', 'Order tracking', 'About', 'Contact', 'Privacy policy']),
        domainName: `${customer.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.bd`,
        hostingChoice: 'BDIX Shared Hosting (managed by WooHelperPro)',
        preferredColors: pick(['Purple & white', 'Black & gold', 'Teal & cream', 'Maroon & beige']),
        brandNotes: 'We already have a logo. Need the storefront to match our Facebook page look.',
        contactPerson: customer.name,
        contactPhone: customer.phone,
        contactEmail: customer.email,
        district: customer.district,
        billingAddress: customer.address,
        subtotal,
        discount,
        tax,
        total,
        paidAmount,
        advancePaid: paidAmount,
        currency: 'BDT',
        couponCode: discount > 0 ? 'EID2026' : null,
        status: finalStatus,
        paymentStatus,
        priority: pick(['NORMAL', 'NORMAL', 'HIGH']),
        assignedTo: pick([staff.manager.id, staff.designer.id, staff.dev.id]),
        internalNotes: `Kickoff call completed. Client wants to keep monthly maintenance after launch.`,
        dueDate: daysAhead(pkg.deliveryDays - plan.daysOld),
        deliveredAt: finalStatus === 'DELIVERED' ? daysAgo(plan.daysOld - pkg.deliveryDays) : null,
        projectUrl: finalStatus === 'DELIVERED' ? `https://${customer.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.bd` : null,
        adminUrl: finalStatus === 'DELIVERED' ? `https://${customer.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.bd/admin` : null,
        createdAt,
        updatedAt: daysAgo(Math.max(1, plan.daysOld - 5)),
      },
    });

    // Delivery project with milestones reflecting the order's real progress.
    const milestones = orderService.defaultMilestones();
    const doneCount = Math.round((plan.progress / 100) * milestones.length);

    const project = await prisma.project.create({
      data: {
        orderId: order.id,
        userId: customer.id,
        name: order.projectName,
        status:
          plan.progress >= 100 ? 'LAUNCHED'
            : plan.progress >= 90 ? 'TESTING'
              : plan.progress >= 70 ? 'CLIENT_REVIEW'
                : plan.progress >= 45 ? 'DEVELOPMENT'
                  : plan.progress > 0 ? 'DESIGNING' : 'NOT_STARTED',
        progress: plan.progress,
        currentStage:
          plan.progress >= 100 ? 'Live and handed over'
            : plan.progress >= 90 ? 'Final testing'
              : plan.progress >= 70 ? 'Awaiting client feedback'
                : plan.progress >= 45 ? 'Development in progress'
                  : plan.progress > 0 ? 'Design mockup' : 'Requirements received',
        managerId: staff.manager.id,
        techStack: 'Node.js, Express, PostgreSQL, Tailwind',
        stagingUrl: plan.progress > 20 ? `https://staging.${customer.company.toLowerCase().replace(/[^a-z0-9]/g, '')}.com.bd` : null,
        liveUrl: plan.progress >= 100 ? order.projectUrl : null,
        kickoffDate: createdAt,
        targetDate: daysAhead(pkg.deliveryDays - plan.daysOld),
        launchedAt: plan.progress >= 100 ? daysAgo(Math.max(1, plan.daysOld - pkg.deliveryDays)) : null,
        milestones: {
          create: milestones.map((m, i) => ({
            title: m.title,
            sortOrder: m.sortOrder,
            isDone: i < doneCount,
            completedAt: i < doneCount ? new Date(createdAt.getTime() + (i + 1) * 3 * 86400000) : null,
            dueDate: new Date(createdAt.getTime() + (i + 1) * 3 * 86400000),
          })),
        },
      },
      include: { milestones: true },
    });

    createdOrders.push({ order, project, customer, pkg });
  }
  console.log(`✓ Orders (${createdOrders.length}) with delivery projects`);

  // ----------------------------------------------------------------
  // 9. Invoices + payments
  // ----------------------------------------------------------------
  let invoiceSeq = 0;
  let paymentSeq = 0;

  for (const entry of createdOrders) {
    const { order, customer } = entry;

    invoiceSeq += 1;
    const invoiceStatus =
      order.paymentStatus === 'PAID' ? 'PAID'
        : order.paymentStatus === 'PARTIAL' ? 'PARTIALLY_PAID'
          : order.dueDate && order.dueDate < new Date() ? 'OVERDUE' : 'SENT';

    const invoice = await prisma.invoice.create({
      data: {
        invoiceNumber: ids.build('INV', invoiceSeq),
        userId: customer.id,
        orderId: order.id,
        title: `Website build — ${order.projectName}`,
        description: `Order ${order.orderNumber}`,
        subtotal: order.subtotal,
        discount: order.discount,
        tax: order.tax,
        total: order.total,
        amountPaid: order.paidAmount,
        status: invoiceStatus,
        issueDate: order.createdAt,
        dueDate: order.dueDate || daysAhead(7),
        paidAt: invoiceStatus === 'PAID' ? order.deliveredAt || daysAgo(10) : null,
      },
    });

    if (order.paidAmount > 0) {
      // Split a full payment into advance + final, which is how agencies
      // actually bill: 40% to start, 60% on delivery.
      const isFull = order.paymentStatus === 'PAID';
      const installments = isFull
        ? [
            { amount: Math.round(order.paidAmount * 0.4), daysOld: 60, method: 'BKASH' },
            { amount: order.paidAmount - Math.round(order.paidAmount * 0.4), daysOld: 20, method: 'BANK_TRANSFER' },
          ]
        : [{ amount: order.paidAmount, daysOld: 45, method: pick(['BKASH', 'NAGAD', 'ROCKET']) }];

      for (const inst of installments) {
        if (inst.amount <= 0) continue;
        paymentSeq += 1;
        await prisma.payment.create({
          data: {
            reference: `WHP-PAY-${String(paymentSeq).padStart(5, '0')}-${pick(['BK', 'NG', 'RK', 'BT'])}`,
            userId: customer.id,
            invoiceId: invoice.id,
            orderId: order.id,
            amount: inst.amount,
            method: inst.method,
            status: 'SUCCESS',
            transactionId: inst.method === 'BANK_TRANSFER' ? `NPSB${randInt(100000, 999999)}` : `${inst.method.slice(0, 2)}${randInt(10000000, 99999999)}`,
            senderNumber: inst.method === 'BANK_TRANSFER' ? null : customer.phone,
            verifiedById: staff.accounts.id,
            verifiedAt: daysAgo(inst.daysOld),
            paidAt: daysAgo(inst.daysOld),
            createdAt: daysAgo(inst.daysOld),
          },
        });
      }
    }
  }

  // A few payments pending verification — this is the queue the accounts team works.
  const pendingTargets = createdOrders.filter((e) => e.order.paymentStatus === 'PARTIAL').slice(0, 3);
  for (const entry of pendingTargets) {
    invoiceSeq += 1;
    const invoice = await prisma.invoice.findFirst({ where: { orderId: entry.order.id } });
    if (!invoice) continue;

    paymentSeq += 1;
    await prisma.payment.create({
      data: {
        reference: `WHP-PAY-${String(paymentSeq).padStart(5, '0')}-PD`,
        userId: entry.customer.id,
        invoiceId: invoice.id,
        orderId: entry.order.id,
        amount: Math.round(entry.order.total * 0.3),
        method: pick(['BKASH', 'NAGAD', 'ROCKET']),
        status: 'PENDING',
        transactionId: `BK${randInt(10000000, 99999999)}`,
        senderNumber: entry.customer.phone,
        createdAt: daysAgo(randInt(1, 6)),
      },
    });
  }
  console.log(`✓ Invoices (${invoiceSeq}) and payments`);

  // ----------------------------------------------------------------
  // 10. Subscriptions — active, trialing, past due, cancelled
  // ----------------------------------------------------------------
  const subPlan = [
    { cust: 0, pkg: 'growth-plan-monthly', status: 'ACTIVE', monthsAgo: 14, cycle: 'MONTHLY' },
    { cust: 1, pkg: 'care-plan-monthly', status: 'ACTIVE', monthsAgo: 9, cycle: 'MONTHLY' },
    { cust: 2, pkg: 'growth-plan-monthly', status: 'ACTIVE', monthsAgo: 7, cycle: 'MONTHLY' },
    { cust: 3, pkg: 'care-plan-monthly', status: 'PAST_DUE', monthsAgo: 6, cycle: 'MONTHLY' },
    { cust: 4, pkg: 'care-plan-monthly', status: 'ACTIVE', monthsAgo: 5, cycle: 'YEARLY' },
    { cust: 5, pkg: 'care-plan-monthly', status: 'TRIALING', monthsAgo: 0, cycle: 'MONTHLY' },
    { cust: 6, pkg: 'growth-plan-monthly', status: 'ACTIVE', monthsAgo: 3, cycle: 'MONTHLY' },
    { cust: 7, pkg: 'care-plan-monthly', status: 'CANCELLED', monthsAgo: 8, cycle: 'MONTHLY' },
    { cust: 9, pkg: 'care-plan-monthly', status: 'ACTIVE', monthsAgo: 2, cycle: 'MONTHLY' },
  ];

  const createdSubs = [];
  let subSeq = 0;

  for (const plan of subPlan) {
    const customer = customers[plan.cust];
    const pkg = packages[plan.pkg];

    subSeq += 1;
    const startsAt = daysAgo(plan.monthsAgo * 30);
    const months = plan.cycle === 'YEARLY' ? 12 : 1;
    const amount = plan.cycle === 'YEARLY' ? pkg.yearlyPrice : pkg.monthlyPrice;

    // For active subs, set the current period so renewal dates spread across
    // the calendar — some due soon, some not for weeks.
    let periodStart;
    let periodEnd;
    if (plan.status === 'PAST_DUE') {
      periodStart = daysAgo(38);
      periodEnd = daysAgo(8);
    } else if (plan.status === 'TRIALING') {
      periodStart = daysAgo(5);
      periodEnd = daysAhead(9);
    } else {
      const offset = randInt(2, 26);
      periodStart = daysAgo(30 - offset);
      periodEnd = daysAhead(offset);
    }

    const subscription = await prisma.subscription.create({
      data: {
        subscriptionNumber: ids.build('SUB', subSeq),
        userId: customer.id,
        packageId: pkg.id,
        planName: pkg.name,
        billingCycle: plan.cycle,
        amount,
        setupFee: 0,
        discountPercent: plan.cycle === 'YEARLY' ? 17 : 0,
        status: plan.status,
        autoRenew: plan.status !== 'CANCELLED',
        startsAt,
        currentPeriodStart: periodStart,
        currentPeriodEnd: periodEnd,
        trialEndsAt: plan.status === 'TRIALING' ? daysAhead(9) : null,
        cancelledAt: plan.status === 'CANCELLED' ? daysAgo(30) : null,
        cancelReason: plan.status === 'CANCELLED' ? 'Client moved to an in-house developer.' : null,
        nextInvoiceAt: periodEnd,
        gracePeriodDays: 7,
        notes: plan.status === 'PAST_DUE' ? 'Two reminders sent. Accounts to follow up by phone.' : null,
        createdAt: startsAt,
      },
    });

    // Add-ons on a few subscriptions.
    if (['ACTIVE', 'PAST_DUE'].includes(plan.status) && rand() > 0.45) {
      const addonChoices = [
        { name: 'Extra Landing Page', nameBn: 'অতিরিক্ত ল্যান্ডিং পেজ', price: 2500, billingCycle: 'MONTHLY' },
        { name: 'Monthly SEO Boost', nameBn: 'মাসিক এসইও বুস্ট', price: 6000, billingCycle: 'MONTHLY' },
        { name: 'Facebook Ads Management', nameBn: 'ফেসবুক অ্যাডস ম্যানেজমেন্ট', price: 8000, billingCycle: 'MONTHLY' },
        { name: 'Priority Support (4h SLA)', nameBn: 'প্রায়োরিটি সাপোর্ট (৪ ঘণ্টা)', price: 3000, billingCycle: 'MONTHLY' },
      ];
      const addon = pick(addonChoices);
      await prisma.subscriptionAddon.create({
        data: { subscriptionId: subscription.id, ...addon, quantity: 1 },
      });
    }

    // Historical renewal invoices for active subscriptions.
    const cycles = plan.status === 'TRIALING' ? 0 : randInt(2, 6);
    for (let i = cycles; i >= 1; i -= 1) {
      invoiceSeq += 1;
      const issueDate = daysAgo(i * 30);
      const paid = i > 1 || plan.status === 'ACTIVE';

      const subInvoice = await prisma.invoice.create({
        data: {
          invoiceNumber: ids.build('INV', invoiceSeq),
          userId: customer.id,
          subscriptionId: subscription.id,
          title: `${pkg.name} — ${plan.cycle.toLowerCase()} renewal`,
          description: `Subscription ${subscription.subscriptionNumber}`,
          subtotal: amount,
          discount: 0,
          tax: Math.round(amount * 0.05),
          total: amount + Math.round(amount * 0.05),
          amountPaid: paid ? amount + Math.round(amount * 0.05) : 0,
          status: paid ? 'PAID' : (issueDate < daysAgo(10) ? 'OVERDUE' : 'SENT'),
          issueDate,
          dueDate: new Date(issueDate.getTime() + 7 * 86400000),
          paidAt: paid ? new Date(issueDate.getTime() + 2 * 86400000) : null,
        },
      });

      if (paid) {
        paymentSeq += 1;
        const method = pick(['BKASH', 'NAGAD', 'ROCKET', 'SSLCOMMERZ']);
        await prisma.payment.create({
          data: {
            reference: `WHP-PAY-${String(paymentSeq).padStart(5, '0')}-RN`,
            userId: customer.id,
            invoiceId: subInvoice.id,
            amount: amount + Math.round(amount * 0.05),
            method,
            status: 'SUCCESS',
            transactionId: `${method.slice(0, 2)}${randInt(10000000, 99999999)}`,
            senderNumber: customer.phone,
            verifiedById: method === 'SSLCOMMERZ' ? null : staff.accounts.id,
            verifiedAt: new Date(issueDate.getTime() + 2 * 86400000),
            paidAt: new Date(issueDate.getTime() + 2 * 86400000),
            createdAt: new Date(issueDate.getTime() + 2 * 86400000),
          },
        });
      }
    }

    createdSubs.push(subscription);
  }
  console.log(`✓ Subscriptions (${createdSubs.length}) with renewal invoices`);

  // ----------------------------------------------------------------
  // 11. Support tickets
  // ----------------------------------------------------------------
  const ticketDefs = [
    { cust: 6, subject: 'Payment gateway showing "merchant not active"', message: 'When a customer tries to pay with Nagad, they get an error saying the merchant account is not active. It was working yesterday. Please check urgently, we are losing orders.', category: 'BILLING', status: 'IN_PROGRESS', priority: 'URGENT', days: 1 },
    { cust: 3, subject: 'Please change the homepage banner image', message: 'We have a new Eid campaign banner. Can you replace the homepage hero image? I have attached the file to our WhatsApp group.', category: 'DESIGN_CHANGE', status: 'WAITING_CUSTOMER', priority: 'NORMAL', days: 2 },
    { cust: 9, subject: 'Courier booking failing for Chattogram', message: 'Pathao booking is throwing an error for Chattogram addresses only. Dhaka orders go through fine.', category: 'TECHNICAL', status: 'OPEN', priority: 'HIGH', days: 0 },
    { cust: 1, subject: 'Request for monthly report format change', message: 'Can the monthly health report include the top 10 selling products? Our management wants that in the same PDF.', category: 'GENERAL', status: 'RESOLVED', priority: 'LOW', days: 12 },
    { cust: 10, subject: 'When can we go live?', message: 'We have already paid the advance. Just want to know the expected launch date so we can plan our Facebook campaign.', category: 'DELIVERY', status: 'OPEN', priority: 'HIGH', days: 1 },
    { cust: 5, subject: 'Refund request for cancelled order', message: 'We decided to postpone the project for three months. Requesting a refund of the advance payment as per your refund policy.', category: 'REFUND', status: 'IN_PROGRESS', priority: 'HIGH', days: 5 },
    { cust: 2, subject: 'Domain email setup', message: 'Can you also set up info@ourdomain.com email accounts? We need five mailboxes.', category: 'DOMAIN', status: 'RESOLVED', priority: 'NORMAL', days: 20 },
    { cust: 7, subject: 'SSL certificate expired warning', message: 'Some customers report a "not secure" warning in Chrome. Please renew the SSL certificate.', category: 'HOSTING', status: 'CLOSED', priority: 'URGENT', days: 30 },
  ];

  let ticketSeq = 0;
  for (const def of ticketDefs) {
    ticketSeq += 1;
    const customer = customers[def.cust];

    const ticket = await prisma.ticket.create({
      data: {
        ticketNumber: ids.build('TCK', ticketSeq),
        userId: customer.id,
        subject: def.subject,
        message: def.message,
        category: def.category,
        priority: def.priority,
        status: def.status,
        assignedTo: def.status === 'OPEN' ? null : staff.support.id,
        createdAt: daysAgo(def.days),
        closedAt: ['RESOLVED', 'CLOSED'].includes(def.status) ? daysAgo(Math.max(0, def.days - 2)) : null,
      },
    });

    // Staff reply on anything that has been picked up.
    if (def.status !== 'OPEN') {
      await prisma.ticketReply.create({
        data: {
          ticketId: ticket.id,
          userId: staff.support.id,
          isStaff: true,
          body: pick([
            'Thanks for reporting this. I have escalated it to our technical team and will update you within four hours.',
            'We are looking into this now. Could you share a screenshot of the error so we can reproduce it faster?',
            'This has been fixed and deployed. Please clear your browser cache and try again — let us know if it persists.',
            'Noted. Our designer will send you the updated mockup by tomorrow afternoon for approval.',
          ]),
          createdAt: daysAgo(Math.max(0, def.days - 1)),
        },
      });
    }

    // Customer follow-up on a couple of them.
    if (['IN_PROGRESS', 'OPEN'].includes(def.status) && def.days > 2) {
      await prisma.ticketReply.create({
        data: {
          ticketId: ticket.id,
          userId: customer.id,
          isStaff: false,
          body: 'Any update on this? Our campaign starts next week so we need it resolved soon.',
          createdAt: daysAgo(Math.max(0, def.days - 2)),
        },
      });
    }
  }
  console.log(`✓ Support tickets (${ticketDefs.length})`);

  // ----------------------------------------------------------------
  // 12. Sales leads
  // ----------------------------------------------------------------
  const leadDefs = [
    { name: 'Faruk Ahmed', phone: '01812345678', company: 'Ahmed Traders', district: 'Dhaka', service: 'Complete E-commerce Website', budget: '50,000 - 100,000', status: 'NEW', source: 'WEBSITE_CONTACT', message: 'I sell mobile accessories on Facebook. I want a proper website with bKash payment.' },
    { name: 'Sumaiya Islam', phone: '01912345678', company: 'Sumaiya Boutique', district: 'Chattogram', service: 'Single-Product Landing Page', budget: '10,000 - 25,000', status: 'CONTACTED', source: 'CALLBACK_REQUEST', message: 'Need a landing page for my saree collection. Running Facebook ads now.' },
    { name: 'Belal Hossain', phone: '01712345678', company: 'Hossain Electronics', district: 'Sylhet', service: 'Complete E-commerce Website', budget: '100,000+', status: 'QUALIFIED', source: 'REFERRAL', message: 'Referred by Gadget Bari. We need a full store with courier integration and POS.' },
    { name: 'Nasrin Sultana', phone: '01612345678', company: 'Nasrin Cosmetics', district: 'Khulna', service: 'Payment Gateway Integration', budget: '15,000 - 30,000', status: 'CONVERTED', source: 'WEBSITE_CONTACT', message: 'Already have a website. Just need Nagad and Rocket added.' },
    { name: 'Rafiqul Islam', phone: '01512345678', company: 'Rafiq General Store', district: 'Rajshahi', service: 'Website Care & Maintenance', budget: 'Under 10,000', status: 'NEW', source: 'CALLBACK_REQUEST', message: 'Website is slow and I keep getting hacked. Need monthly maintenance.' },
    { name: 'Ayesha Siddika', phone: '01312345678', company: 'Ayesha Home Chef', district: 'Dhaka', service: 'Single-Product Landing Page', budget: '10,000 - 25,000', status: 'CONTACTED', source: 'WALK_IN', message: 'Home catering business. Need online ordering for Dhaka delivery.' },
    { name: 'Mizanur Rahman', phone: '01812345679', company: 'Mizan Agro', district: 'Bogura', service: 'Complete E-commerce Website', budget: '30,000 - 50,000', status: 'NEW', source: 'WEBSITE_CONTACT', message: 'Selling organic rice and spices wholesale. Want B2B ordering too.' },
    { name: 'Tahmina Akter', phone: '01712345680', company: 'Tahmina Fashion', district: 'Narayanganj', service: 'Facebook & TikTok Ads Management', budget: '10,000 - 25,000', status: 'LOST', source: 'WEBSITE_CONTACT', message: 'Went with a cheaper freelancer.' },
    { name: 'Shafiqul Alam', phone: '01912345681', company: 'Alam Pharmacy', district: 'Cumilla', service: 'Courier & Logistics Integration', budget: '10,000 - 25,000', status: 'QUALIFIED', source: 'REFERRAL', message: 'Need Steadfast integration for 200+ daily orders.' },
    { name: 'Jannatul Ferdous', phone: '01612345682', company: 'Jannat Kids Wear', district: 'Mymensingh', service: 'Brand Identity & Logo Design', budget: 'Under 10,000', status: 'NEW', source: 'FACEBOOK', message: 'Need a logo and full brand kit for my kids clothing brand.' },
  ];

  for (const def of leadDefs) {
    await prisma.lead.create({
      data: {
        name: def.name,
        phone: def.phone,
        email: `${def.name.toLowerCase().replace(/\s+/g, '.')}@example.com`,
        company: def.company,
        district: def.district,
        serviceType: def.service,
        budget: def.budget,
        message: def.message,
        source: def.source,
        status: def.status,
        assignedTo: def.status === 'NEW' ? null : staff.manager.id,
        followUpAt: ['CONTACTED', 'QUALIFIED'].includes(def.status) ? daysAhead(randInt(1, 7)) : null,
        notes: def.status === 'LOST' ? 'Price objection. Revisit in six months.' : null,
        createdAt: daysAgo(randInt(1, 60)),
      },
    });
  }
  console.log(`✓ Sales leads (${leadDefs.length})`);

  // ----------------------------------------------------------------
  // 13. Testimonials
  // ----------------------------------------------------------------
  const testimonialDefs = [
    { clientName: 'Shahidul Islam', company: 'Fashion Hub BD', district: 'Dhaka', rating: 5, body: 'We were tracking orders in a notebook before this. Now everything is automatic — bKash payment confirms itself and the courier gets booked with one click. Our daily order handling time dropped from four hours to about forty minutes.', isApproved: true, isFeatured: true },
    { clientName: 'Mehjabin Chowdhury', company: 'Glow Beauty Care', district: 'Dhaka', rating: 5, body: 'The fake order protection alone paid for the whole project in the first month. We used to lose around ৳40,000 a month to orders that never got delivered. That stopped completely.', isApproved: true, isFeatured: true },
    { clientName: 'Arif Hossain', company: 'Gadget Bari', district: 'Chattogram', rating: 5, body: 'Site loads instantly even on mobile data, which matters because 90% of our buyers are on phones. Sales went up 35% in the first two months compared to our old site.', isApproved: true, isFeatured: true },
    { clientName: 'Sultana Razia', company: 'Organic Hut', district: 'Sylhet', rating: 4, body: 'Very responsive team. They answered every question in Bangla and explained things without jargon. Delivery took two days longer than promised but the quality made up for it.', isApproved: true, isFeatured: false },
    { clientName: 'Kamrul Hasan', company: 'Islamic Store BD', district: 'Dhaka', rating: 5, body: 'The admin panel is simple enough that my brother manages it without any technical knowledge. That was my main requirement and they delivered exactly that.', isApproved: true, isFeatured: false },
    { clientName: 'Nadia Sultana', company: 'Home Decor Bangladesh', district: 'Rajshahi', rating: 5, body: 'Being outside Dhaka, I was worried about support. But the monthly care plan means I just message them and changes happen the same day. Worth every taka.', isApproved: true, isFeatured: true },
    { clientName: 'Tasnim Rahman', company: 'FitLife Supplements', district: 'Khulna', rating: 4, body: 'Good work overall. The SEO setup got us onto the first page for our main keyword within three months, which brought in steady organic orders.', isApproved: true, isFeatured: false },
    { clientName: 'Rezaul Karim', company: 'Kitab Ghor', district: 'Dhaka', rating: 5, body: 'They migrated 4,000 book listings from our old site without losing a single image. I did not think that was possible.', isApproved: false, isFeatured: false },
  ];

  for (const def of testimonialDefs) {
    await prisma.testimonial.create({
      data: { ...def, createdAt: daysAgo(randInt(5, 200)) },
    });
  }
  console.log(`✓ Testimonials (${testimonialDefs.length})`);

  // ----------------------------------------------------------------
  // 14. Portfolio
  // ----------------------------------------------------------------
  const portfolioDefs = [
    { title: 'Fashion Hub BD — Multi-category Clothing Store', clientName: 'Fashion Hub BD', category: 'Fashion', slug: 'fashion-hub-bd', description: 'Full e-commerce build for a Dhaka-based clothing brand selling across all 64 districts. Includes size and colour variants, bKash/Nagad checkout, and Steadfast integration for 300+ daily orders.', results: '3.2x revenue growth in 8 months', techStack: 'Node.js, PostgreSQL, Tailwind', isFeatured: true, sortOrder: 1 },
    { title: 'Glow Beauty Care — Cosmetics Brand Store', clientName: 'Glow Beauty Care', category: 'Cosmetics', slug: 'glow-beauty-care', description: 'Beauty and skincare store with subscription refills, fake-order screening and a reviewer programme. Custom risk scoring blocked 1,100 fraudulent orders in the first quarter.', results: '৳40,000/month saved on fake orders', techStack: 'Node.js, Redis, Tailwind', isFeatured: true, sortOrder: 2 },
    { title: 'Gadget Bari — Electronics & Mobile Accessories', clientName: 'Gadget Bari', category: 'Electronics', slug: 'gadget-bari', description: 'High-volume electronics store in Chattogram with warranty tracking, serial number management and Pathao bulk dispatch. Optimised to load in under 0.7 seconds on 3G.', results: '35% sales increase, 0.7s load time', techStack: 'Node.js, PostgreSQL, CDN', isFeatured: true, sortOrder: 3 },
    { title: 'Organic Hut — Grocery & Organic Produce', clientName: 'Organic Hut', category: 'Grocery', slug: 'organic-hut', description: 'Daily-delivery grocery platform in Sylhet with slot-based delivery scheduling, weight-based pricing and route-optimised dispatch for perishable goods.', results: '1,800+ monthly repeat orders', techStack: 'Node.js, PostgreSQL', isFeatured: false, sortOrder: 4 },
    { title: 'Islamic Store BD — Books & Religious Products', clientName: 'Islamic Store BD', category: 'Islamic', slug: 'islamic-store-bd', description: 'Catalogue of 2,400 titles with Bangla and Arabic search, author and publisher browsing, and e-book delivery with per-user download limits.', results: '2,400 titles migrated, zero downtime', techStack: 'Node.js, Elasticsearch', isFeatured: false, sortOrder: 5 },
    { title: 'Home Decor Bangladesh — Furniture & Interiors', clientName: 'Home Decor Bangladesh', category: 'Home Decor', slug: 'home-decor-bangladesh', description: 'Furniture store with dimension-based shipping calculation, delivery-zone rules for Rajshahi division, and assembly-scheduling at checkout.', results: '42% reduction in delivery disputes', techStack: 'Node.js, PostgreSQL', isFeatured: false, sortOrder: 6 },
  ];

  for (const def of portfolioDefs) {
    await prisma.portfolioItem.create({
      data: { ...def, isPublished: true, liveUrl: `https://${def.slug.replace(/-/g, '')}.com.bd`, createdAt: daysAgo(randInt(20, 300)) },
    });
  }
  console.log(`✓ Portfolio items (${portfolioDefs.length})`);

  // ----------------------------------------------------------------
  // 15. Blog posts
  // ----------------------------------------------------------------
  const blogDefs = [
    {
      title: 'How to Reduce Cash-on-Delivery Fake Orders in Bangladesh',
      slug: 'reduce-cod-fake-orders-bangladesh',
      category: 'Operations',
      excerpt: 'Fake COD orders are the single biggest silent cost for Bangladeshi online sellers. Here is the four-layer screening system we set up on every store we build.',
      content: `Cash on delivery is still how the overwhelming majority of online orders in Bangladesh get paid. It builds trust with first-time buyers — and it also exposes you to a problem that does not exist at the same scale anywhere else: the fake order.

A fake order is a COD order placed with no intention of accepting delivery. You pay the courier twice (outbound and return), you lose the packaging, and if the product is perishable or customised, you lose the goods as well. For a store doing 200 orders a day, a 15% fake-order rate can quietly consume most of your margin.

**Layer 1: Phone number risk scoring**

Before an order is accepted, check the phone number against courier history. Pathao, Steadfast and RedX all expose APIs that return a delivery success rate for a given number. If a number has attempted ten deliveries and refused nine, that is your answer.

We block or hold any order above a configurable risk threshold. The threshold matters — set it too aggressively and you turn away real customers.

**Layer 2: Duplicate and velocity detection**

The same phone number placing five orders in ten minutes is not a real buyer. Neither is the same address combined with a different phone number on every attempt. Both patterns are trivially detectable and both are extremely common.

**Layer 3: OTP confirmation for high-value orders**

For orders above a value threshold, require the customer to confirm a six-digit OTP sent by SMS. Real buyers confirm in seconds. Fake orderers abandon. The cost is a few paisa per SMS and the conversion loss is under 3%.

**Layer 4: Incomplete order recovery**

Roughly a third of people who start a checkout never finish it. Instead of letting them go, capture the phone number as soon as it is entered and follow up with a call or an SMS link back to the basket. This recovers orders you already paid ad money to attract.

**What this looks like in practice**

On a store doing 300 orders a day with a 12% fake-order rate, these four layers typically cut the rate to under 3%. At an average order value of ৳1,200 and ৳150 in courier cost per failed delivery, that is roughly ৳100,000 a month back in your pocket.

Every WooHelperPro e-commerce build ships with all four layers configured, because in this market they are not optional extras.`,
      tags: ['COD', 'Fraud Prevention', 'Operations'],
      days: 8,
      views: 1240,
    },
    {
      title: 'bKash vs Nagad vs Rocket: Which Payment Gateway Should Your Store Use?',
      slug: 'bkash-nagad-rocket-comparison-bd',
      category: 'Payments',
      excerpt: 'A practical comparison of the three mobile financial services your customers actually use — settlement time, fees, integration effort and when to add card payments on top.',
      content: `If you sell online in Bangladesh, you need at least one mobile financial service integrated. Most established stores need two. Here is how the three main options compare for an e-commerce business.

**bKash**

The market leader by a wide margin. Roughly two-thirds of mobile wallet transactions in Bangladesh go through bKash, and its brand recognition means customers trust the checkout button without hesitation.

Merchant integration is available through the Tokenized Checkout API. Settlement to your bank account typically takes one working day. Transaction fees are negotiable based on monthly volume, but budget around 1.5% to 2%.

The main friction is the merchant onboarding process, which requires trade licence, TIN, bank account and a physical verification visit. Budget two to three weeks.

**Nagad**

Postal Department-backed, which gives it strong trust in smaller towns and rural areas — precisely where a lot of Bangladeshi e-commerce volume sits. Fees tend to be slightly lower than bKash, and small merchants report faster onboarding.

The integration API is less mature than bKash's and documentation is thinner. We generally see a higher rate of failed transactions that require manual reconciliation.

**Rocket**

Operated by Dutch-Bangla Bank. It has the smallest user base of the three, but its users are often in regions where bKash penetration is weaker. Worth adding if your delivery data shows a concentration of orders in those districts.

**Our recommendation**

Start with bKash. Add Nagad once your monthly online payment volume passes roughly ৳3,00,000, because at that point the additional transaction coverage outweighs the reconciliation overhead. Add Rocket only if your order data justifies it.

**And card payments?**

SSLCommerz handles Visa, Mastercard, AmEx and net banking in one integration. Card payments are still a small share of Bangladeshi e-commerce volume — typically 3% to 8% — but the average order value on cards is significantly higher than on wallet or COD.

If your catalogue includes items above ৳5,000, adding card checkout is worth it. Below that, it is usually not a priority.

**Never skip cash on delivery**

Whatever you integrate, keep COD available. A large share of Bangladeshi online buyers will not pay before seeing the product. You can require a partial advance for high-value or customised orders, but removing COD entirely will cost you more orders than it protects.`,
      tags: ['bKash', 'Nagad', 'Payments', 'Integration'],
      days: 21,
      views: 2180,
    },
    {
      title: 'Why Your Website Load Speed Matters More in Bangladesh Than Anywhere Else',
      slug: 'website-speed-bangladesh',
      category: 'Performance',
      excerpt: 'Most Bangladeshi online shoppers browse on mid-range Android phones over 3G or congested 4G. Every extra second of load time costs you measurable revenue.',
      content: `A designer reviewing a website on a MacBook Pro over office fibre sees a completely different site from a customer on a ৳15,000 Android phone on a congested 4G connection in Narayanganj. If you optimise for the first and sell to the second, you are losing money you cannot see.

**The numbers**

Independent studies consistently show mobile conversion dropping by around 12% to 20% for every additional second of load time. On a Bangladeshi connection, an unoptimised e-commerce site routinely takes four to six seconds to become interactive.

Do the arithmetic on your own store. If you do 500 orders a month at ৳1,200 average value, that is ৳6,00,000 in monthly revenue. A two-second improvement, at a conservative 15% conversion lift, is ৳90,000 a month — more than most stores spend on their entire website build.

**What actually causes the slowdown**

Nine times out of ten it is the same four things:

*Uncompressed images.* A 4MB product photo straight from a phone camera. A store with 200 products is serving close to a gigabyte of images nobody needs at that resolution.

*Render-blocking JavaScript.* Marketing pixels, chat widgets and analytics tags loaded synchronously in the head, each one pausing the page.

*No caching strategy.* Every page view hits the database, even for content that changes once a week.

*Shared hosting on a slow origin.* A BDIX-hosted server responds in under 100ms. A server in Singapore or the US adds 300ms to 800ms before a single byte of content arrives.

**The fixes, in priority order**

First, compress and correctly size every image. Serve WebP, cap display width at what the layout actually needs, and lazy-load anything below the fold. This alone often halves page weight.

Second, defer every non-critical script. Load analytics and pixels after the main content is interactive. Nothing in your marketing stack needs to block first paint.

Third, cache aggressively. Server-side caching for catalogue pages, browser caching for static assets, and a CDN in front of images.

Fourth, host on BDIX. For a Bangladeshi audience, a local origin with local peering beats an overseas server on every metric that matters to your customers.

**How we verify it**

We test on a throttled 3G profile on a mid-range Android device, not on desktop. The number that matters is not your Lighthouse score — it is what a real customer experiences during their commute.`,
      tags: ['Performance', 'SEO', 'Hosting'],
      days: 35,
      views: 1620,
    },
    {
      title: 'Pathao vs Steadfast vs RedX: Choosing a Courier for Your E-commerce Store',
      slug: 'pathao-steadfast-redx-courier-comparison',
      category: 'Logistics',
      excerpt: 'Coverage, COD remittance speed, API quality and the failure modes that actually cost you money. Based on delivery data from stores we manage.',
      content: `Your courier partner is a bigger determinant of customer satisfaction than your website design. Here is what we see across the stores we manage.

**Pathao Courier**

Widest coverage and the strongest brand recognition with customers, who often explicitly ask for Pathao delivery. API is well documented and reliable, with good webhook support for status updates.

COD remittance is typically weekly. Its weakness is price in the lower-volume tiers — if you are under 300 parcels a month, you will pay noticeably more per parcel than with competitors.

Best for: stores in Dhaka and Chattogram doing consistent volume, where customer preference matters.

**Steadfast**

Our default recommendation for most small and mid-size stores. Competitive rates from a low volume threshold, fast remittance (often twice weekly), and API integration that is straightforward.

Coverage in the deep districts is weaker than Pathao. For Sylhet, Barishal and some parts of Rangpur division, we route through Pathao instead.

Best for: growing stores where per-parcel cost and cash-flow speed matter most.

**RedX**

Strong in the southern districts and competitively priced. API is functional but less polished, and status webhooks can be delayed by several hours, which creates confusion for customers tracking orders.

Best for: stores with order concentration in Khulna and Barisal divisions.

**e-Courier**

Useful as a backup for high-season overflow. We integrate it as a fallback so that a single courier's capacity problem does not stall your dispatch queue during Eid.

**The real operational advice**

Do not commit to one courier. Route by district automatically. We configure each store with a primary carrier and a fallback, with district-level rules based on actual delivery success rates recorded in your own order data.

After three months you will have enough data to see which carrier actually performs in which district — and that routing decision alone typically improves delivery success by 8 to 12 percentage points.`,
      tags: ['Courier', 'Pathao', 'Steadfast', 'Logistics'],
      days: 52,
      views: 3110,
    },
    {
      title: 'Product Photography on a Budget: A Practical Guide for Bangladeshi Sellers',
      slug: 'product-photography-budget-guide-bd',
      category: 'Marketing',
      excerpt: 'You do not need a studio. You need daylight, a clean background and consistency. Here is the setup we recommend to every client who asks.',
      content: `The single biggest conversion lever on a product page is the photograph. Buyers cannot touch the product, so the image has to do that work. Fortunately, good product photography requires far less equipment than most sellers assume.

**The setup**

A north-facing window for soft, indirect daylight — direct sun creates harsh shadows and blown highlights. A white foam board as a bounce card on the opposite side to fill shadows. A second board behind the product as the background. A sheet of white paper under the product as a seamless base.

That is the entire studio. Total cost under ৳500.

**The camera**

A recent mid-range Android phone is genuinely sufficient. What matters is the light and the framing, not the sensor. If you have a tripod, use it — consistency between shots is worth more than absolute sharpness.

**Consistency rules**

Shoot every product in the same setup, from the same angle, at the same distance, with the same background. Your catalogue should look like one catalogue, not twelve unrelated eBay listings.

Shoot a minimum of four images per product: front on white, detail close-up, in-use or scale reference, and packaging.

**Post-processing**

Free tools are enough. Correct the white balance so the background is actually white, not grey or blue. Crop to a consistent square or 4:5 ratio. Export at 1200 pixels on the long edge as WebP.

Do not over-saturate. Customers in Bangladesh return products that do not match the photo — and with COD, that return costs you the courier fee both ways.

**The mistakes that cost you money**

Photographing on a bed with patterned sheets. Using different lighting for different products. Leaving the price tag or a competitor's branding visible. Photographing clothing flat when a customer wants to see how it drapes.

If you sell fashion, get a person to wear the item. Flat-lay clothing photographs convert poorly in every market we have measured, and Bangladesh is no exception.`,
      tags: ['Photography', 'Marketing', 'Conversion'],
      days: 75,
      views: 890,
    },
    {
      title: 'Setting Up a Facebook Campaign That Actually Sells in Bangladesh',
      slug: 'facebook-campaign-setup-bangladesh',
      category: 'Marketing',
      excerpt: 'Campaign structure, audience setup, creative testing and the events you must track. Optimised for delivered orders, not clicks.',
      content: `Most Bangladeshi e-commerce Facebook campaigns are optimised for the wrong event. If you optimise for link clicks, Facebook finds you people who click links. If you optimise for purchases, it finds people who buy.

**Fix your event setup first**

Get the Pixel and the Conversions API both running. Browser-only tracking loses a large share of conversion events — sometimes 30% or more — because of ad blockers, iOS privacy and slow mobile connections that drop the request.

With server-side tracking, your conversion data is far more complete, and Facebook's optimisation engine has accurate signals to learn from.

Then define your real conversion event. For a COD business, the purchase event fires on order placement — but a large share of those orders never get delivered. Some stores we work with fire a custom "delivered" event from their admin system and optimise against that instead.

**Campaign structure**

Start simple. One campaign, broad audience, a small number of ad sets testing genuinely different creative angles. Bangladeshi audiences respond strongly to creative differences and weakly to granular interest targeting — the interest layer rarely earns its complexity.

Let the algorithm spend. Fragmenting a small budget across many ad sets means none of them exits the learning phase.

**Creative that works here**

Price visible in the creative. A clear delivery charge statement. Trust signals — real customer photos, order counts, a recognisable brand presence. Bangla copy performed better than English in every test we ran, though mixed Bangla-English performs best of all for urban audiences.

Video outperforms static for most categories, but the first three seconds have to show the product. Not your logo, not a slow build-up.

**Budget discipline**

Set a cost-per-result ceiling before you start and treat it as a hard constraint. An ad set that has spent three times your target cost per purchase without a purchase is not going to turn around.

Kill it and move the budget.

**The metric that actually matters**

Not ROAS on placed orders. ROAS on *delivered* orders. If you optimise against placed orders while 20% of them never get delivered, you will scale a campaign that loses money — and the dashboard will tell you it is succeeding the whole time.`,
      tags: ['Facebook Ads', 'Marketing', 'Conversion Tracking'],
      days: 96,
      views: 2470,
    },
  ];

  for (const def of blogDefs) {
    await prisma.blogPost.create({
      data: {
        title: def.title,
        slug: def.slug,
        excerpt: def.excerpt,
        content: def.content,
        category: def.category,
        tags: JSON.stringify(def.tags),
        authorId: admin.id,
        status: 'PUBLISHED',
        views: def.views,
        metaTitle: `${def.title} | WooHelperPro`,
        metaDescription: def.excerpt.slice(0, 155),
        publishedAt: daysAgo(def.days),
        createdAt: daysAgo(def.days),
      },
    });
  }
  console.log(`✓ Blog posts (${blogDefs.length})`);

  // ----------------------------------------------------------------
  // 16. FAQs
  // ----------------------------------------------------------------
  const faqDefs = [
    { question: 'How long does it take to build my website?', answer: 'A single-product landing page takes 5 days. A standard e-commerce store takes 10 to 14 days. Larger marketplace builds with vendor management take 4 to 6 weeks. The timeline starts once we have your product data, images and content — delays in supplying those are the most common reason projects run over.', category: 'DELIVERY', sortOrder: 1 },
    { question: 'What do I need to provide to get started?', answer: 'Your business name and logo, product names with prices and descriptions, product photographs, and your delivery charge structure by district. If you already sell on Facebook, we can work from your existing product posts. If you do not have a logo, add our brand identity service.', category: 'DELIVERY', sortOrder: 2 },
    { question: 'Can I pay in instalments?', answer: 'Yes. Our standard terms are 40% advance to begin work and 60% on delivery, before the site goes live on your domain. For packages above ৳1,00,000 we can split payments across three or four milestones — talk to your account manager.', category: 'BILLING', sortOrder: 3 },
    { question: 'Which payment methods do you accept?', answer: 'bKash, Nagad, Rocket, bank transfer (BEFTN/RTGS/NPSB), and card payments through SSLCommerz. Submit your transaction ID from your dashboard and our accounts team verifies wallet payments within one business hour.', category: 'BILLING', sortOrder: 4 },
    { question: 'Do I own the website and the data?', answer: 'Completely. At handover you receive the domain registration, hosting account credentials, admin panel access and a full database export. We do not hold your business hostage and there is no lock-in — you can move to another developer at any time.', category: 'GENERAL', sortOrder: 5 },
    { question: 'What happens after my free support period ends?', answer: 'You can continue without a plan — the site stays yours and stays online as long as hosting is paid. Most clients move to a Care Plan (৳3,500/month) which covers hosting, SSL, daily backups, security patching and four hours of content changes each month.', category: 'SUBSCRIPTION', sortOrder: 6 },
    { question: 'Can I cancel my monthly plan?', answer: 'Yes, at any time from your dashboard with no penalty. Your website remains live until the end of the period you have already paid for. After that you can either take over hosting yourself or we can transfer it to an account in your name.', category: 'SUBSCRIPTION', sortOrder: 7 },
    { question: 'Do you provide the domain and hosting?', answer: 'We register the domain in your name and set up BDIX hosting for you. Hosting is included free for 6 to 12 months depending on your package. After that it is ৳1,200 per month, or included in any Care Plan.', category: 'HOSTING', sortOrder: 8 },
    { question: 'Will my site work on mobile phones?', answer: 'Every site we build is mobile-first. Roughly 85% of e-commerce traffic in Bangladesh comes from phones, so we design for a mid-range Android device on a mobile connection first and adapt upward to desktop — not the other way round.', category: 'GENERAL', sortOrder: 9 },
    { question: 'What if I need changes after the site is live?', answer: 'Content changes are included in your support period and in any Care Plan. New features and functionality are quoted separately based on scope. In practice, most day-to-day changes — product updates, banner changes, price revisions — you will do yourself in the admin panel after training.', category: 'TECHNICAL', sortOrder: 10 },
  ];

  for (const def of faqDefs) {
    await prisma.faq.create({ data: { ...def, isActive: true } });
  }
  console.log(`✓ FAQs (${faqDefs.length})`);

  // ----------------------------------------------------------------
  // 17. Activity log — a believable recent trail
  // ----------------------------------------------------------------
  const activityDefs = [
    { user: admin.id, action: 'auth.login', detail: 'Signed in from Dhaka', hours: 1 },
    { user: staff.accounts.id, action: 'payment.verified', detail: 'bKash payment ৳27,300 verified', hours: 2 },
    { user: staff.support.id, action: 'ticket.replied', detail: 'Replied to ticket about Nagad merchant error', hours: 3 },
    { user: staff.manager.id, action: 'order.status_changed', detail: 'Order moved to IN_PROGRESS', hours: 5 },
    { user: admin.id, action: 'package.updated', detail: 'Professional Store pricing updated', hours: 8 },
    { user: staff.designer.id, action: 'project.updated', detail: 'Design mockup completed for Glow Beauty Care', hours: 11 },
    { user: staff.manager.id, action: 'subscription.created', detail: 'New Growth Plan subscription', hours: 14 },
    { user: staff.accounts.id, action: 'invoice.created', detail: 'Renewal invoice issued', hours: 20 },
    { user: admin.id, action: 'service.created', detail: 'Added Couriers & Logistics Integration service', hours: 26 },
    { user: staff.support.id, action: 'lead.updated', detail: 'Lead qualified — Hossain Electronics', hours: 30 },
    { user: staff.dev.id, action: 'project.updated', detail: 'Deployed staging build for Gadget Bari', hours: 36 },
    { user: admin.id, action: 'settings.updated', detail: 'Site settings saved', hours: 48 },
  ];

  for (const def of activityDefs) {
    await prisma.activityLog.create({
      data: {
        userId: def.user,
        action: def.action,
        detail: def.detail,
        ip: `103.${randInt(1, 250)}.${randInt(1, 250)}.${randInt(1, 250)}`,
        userAgent: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
        createdAt: new Date(Date.now() - def.hours * 3600000),
      },
    });
  }
  console.log(`✓ Activity log entries (${activityDefs.length})`);

  // ----------------------------------------------------------------
  // 18. Client notes
  // ----------------------------------------------------------------
  await prisma.clientNote.createMany({
    data: [
      { userId: customers[0].id, authorId: staff.manager.id, body: 'Long-term client since 2024. Always pays on time. Interested in a mobile app next financial year.', createdAt: daysAgo(30) },
      { userId: customers[3].id, authorId: staff.accounts.id, body: 'Subscription is past due by 8 days. Two SMS reminders sent. Manager to call personally this week.', createdAt: daysAgo(4) },
      { userId: customers[5].id, authorId: staff.support.id, body: 'Prefers communication in Bangla. Call rather than email — he does not check email regularly.', createdAt: daysAgo(15) },
      { userId: customers[9].id, authorId: staff.manager.id, body: 'Requested a refund on the cancelled project. Escalated to management for approval per our refund policy.', createdAt: daysAgo(5) },
    ],
  });
  console.log('✓ Client notes (4)');

  // ----------------------------------------------------------------
  // Done
  // ----------------------------------------------------------------
  const counts = {
    users: await prisma.user.count(),
    services: await prisma.service.count(),
    packages: await prisma.package.count(),
    orders: await prisma.order.count(),
    subscriptions: await prisma.subscription.count(),
    invoices: await prisma.invoice.count(),
    payments: await prisma.payment.count(),
    tickets: await prisma.ticket.count(),
    leads: await prisma.lead.count(),
    posts: await prisma.blogPost.count(),
  };

  console.log('─'.repeat(62));
  console.log('\n✓ Seed complete\n');
  console.log('  Database totals:');
  Object.entries(counts).forEach(([key, value]) => {
    console.log(`    ${key.padEnd(15)} ${value}`);
  });

  const mrr = await prisma.subscription.findMany({
    where: { status: 'ACTIVE' },
    select: { amount: true, billingCycle: true },
  });
  const cycleMonths = { MONTHLY: 1, QUARTERLY: 3, HALF_YEARLY: 6, YEARLY: 12 };
  const mrrTotal = mrr.reduce((s, x) => s + x.amount / (cycleMonths[x.billingCycle] || 1), 0);

  console.log('\n  Commercials:');
  console.log(`    MRR (normalised) ৳${Math.round(mrrTotal).toLocaleString('en-BD')}`);
  console.log(`    ARR (normalised) ৳${Math.round(mrrTotal * 12).toLocaleString('en-BD')}`);

  console.log('\n' + '─'.repeat(62));
  console.log('\n  Sign in with:\n');
  console.log(`    Super admin   ${admin.email}`);
  console.log(`                  ${adminPassword}`);
  console.log('');
  console.log(`    Admin         ${staff.accounts.email}`);
  console.log(`    Manager       ${staff.manager.email}`);
  console.log(`    Support       ${staff.support.email}`);
  console.log(`    Staff         ${staff.designer.email}`);
  console.log(`                  ${demoPassword}   (all staff)`);
  console.log('');
  console.log(`    Customer      ${customers[0].email}`);
  console.log(`                  ${demoPassword}   (all customers)`);
  console.log('');
  console.log('─'.repeat(62) + '\n');
}

main()
  .catch((err) => {
    console.error('\n✗ Seed failed:\n');
    console.error(err);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
