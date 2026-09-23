'use strict';

/**
 * UI string dictionary: English -> Bangla.
 *
 * The `Bn` columns in the database cover CONTENT (service titles, package names,
 * blog posts). They never covered the chrome -- buttons, headings, form labels,
 * empty states -- which was all hardcoded English in the views. That is why
 * setting the language to Bangla left most of the page in English.
 *
 * Views call t('Add to cart') and get the Bangla string when the language is bn.
 *
 * RULES FOR ADDING KEYS
 *  1. Keys must be TRIMMED. The translation wrapper trims captured text before
 *     looking it up, so 'Choose ' (with a trailing space) never matches and the
 *     string silently stays English. This bit me on six strings already.
 *  2. Keys must be the exact English source text, so a view reads naturally.
 *  3. A miss returns the English key unchanged rather than a placeholder, so a
 *     partially translated page still reads properly.
 *  4. No duplicate keys -- in a JS object literal the last one silently wins.
 *     `npm run lint:i18n` checks for this.
 */

const BN = {
  // ============================================================
  // Navigation & chrome
  // ============================================================
  Home: 'হোম',
  Services: 'সার্ভিস',
  Packages: 'প্যাকেজ',
  Portfolio: 'পোর্টফোলিও',
  Blog: 'ব্লগ',
  About: 'আমাদের সম্পর্কে',
  'About us': 'আমাদের সম্পর্কে',
  Pricing: 'মূল্য',
  Contact: 'যোগাযোগ',
  FAQs: 'সাধারণ প্রশ্ন',
  Login: 'লগ ইন',
  Logout: 'লগ আউট',
  Register: 'নিবন্ধন',
  'Sign in': 'সাইন ইন',
  'Sign out': 'সাইন আউট',
  'Create an account': 'অ্যাকাউন্ট তৈরি করুন',
  Dashboard: 'ড্যাশবোর্ড',
  'My account': 'আমার অ্যাকাউন্ট',
  'Back to website': 'ওয়েবসাইটে ফিরে যান',
  'View website': 'ওয়েবসাইট দেখুন',
  'Toggle theme': 'থিম পরিবর্তন',
  'Switch language': 'ভাষা পরিবর্তন',
  Menu: 'মেনু',
  'Our work': 'আমাদের কাজ',
  'System status': 'সিস্টেম স্ট্যাটাস',

  // ============================================================
  // Common actions
  // ============================================================
  Save: 'সংরক্ষণ',
  Cancel: 'বাতিল',
  Delete: 'মুছুন',
  Edit: 'সম্পাদনা',
  Update: 'আপডেট',
  Create: 'তৈরি করুন',
  Submit: 'জমা দিন',
  Send: 'পাঠান',
  Search: 'খুঁজুন',
  Filter: 'ফিল্টার',
  'Clear filters': 'ফিল্টার মুছুন',
  Clear: 'মুছুন',
  Copy: 'কপি',
  Copied: 'কপি হয়েছে',
  Show: 'দেখান',
  Hide: 'লুকান',
  Back: 'পেছনে',
  Next: 'পরবর্তী',
  Previous: 'পূর্ববর্তী',
  Continue: 'চালিয়ে যান',
  'Learn more': 'আরও জানুন',
  'See details': 'বিস্তারিত দেখুন',
  'View all': 'সব দেখুন',
  'Read more': 'আরও পড়ুন',
  'Read next': 'পরের লেখা',
  'Read all articles': 'সব লেখা পড়ুন',
  Details: 'বিস্তারিত',
  'Get started': 'শুরু করুন',
  'Choose this package': 'এই প্যাকেজ নিন',
  'Request this': 'অনুরোধ করুন',
  'Start this service': 'এই সার্ভিস নিন',
  'Contact us': 'যোগাযোগ করুন',
  'Talk to us': 'কথা বলুন',
  'Select a package': 'একটি প্যাকেজ বেছে নিন',
  'Select district': 'জেলা বেছে নিন',
  'Open a ticket': 'টিকেট খুলুন',

  // ============================================================
  // Homepage
  // ============================================================
  'What we do': 'আমরা কী করি',
  'Packages & pricing': 'প্যাকেজ ও মূল্য',
  'Why WooHelperPro': 'কেন WooHelperPro',
  'Recent work': 'সাম্প্রতিক কাজ',
  'Client feedback': 'ক্লায়েন্টের মতামত',
  'From the blog': 'ব্লগ থেকে',
  'Common questions': 'সাধারণ প্রশ্ন',
  'Everything your online shop needs': 'আপনার অনলাইন শপের যা যা প্রয়োজন',
  'One-time build, or build + monthly care': 'একবারের বিল্ড, অথবা বিল্ড + মাসিক কেয়ার',
  'Built for how Bangladesh actually sells online': 'বাংলাদেশে যেভাবে অনলাইন বিক্রি হয়, তার জন্য তৈরি',
  'Websites we built and launched': 'আমাদের তৈরি ও লঞ্চ করা ওয়েবসাইট',
  'What our clients say': 'ক্লায়েন্টরা কী বলছেন',
  'From order to live website in four steps': 'অর্ডার থেকে লাইভ ওয়েবসাইট — চার ধাপে',
  'Guides for selling online in Bangladesh': 'বাংলাদেশে অনলাইনে বিক্রির গাইড',
  'Frequently asked questions': 'সাধারণ জিজ্ঞাসা',
  'Ready to start selling online?': 'অনলাইনে বিক্রি শুরু করতে প্রস্তুত?',
  'How it works': 'কীভাবে কাজ করে',
  'Why choose us': 'কেন আমাদের বেছে নেবেন',
  'Our services': 'আমাদের সার্ভিস',
  'Popular packages': 'জনপ্রিয় প্যাকেজ',
  'What clients say': 'ক্লায়েন্টরা কী বলেন',
  'Latest articles': 'সর্বশেষ লেখা',
  'Ready to get online?': 'অনলাইনে আসতে প্রস্তুত?',
  'Get a free consultation': 'ফ্রি পরামর্শ নিন',
  'Start a conversation': 'কথা শুরু করুন',
  'Start my website': 'আমার ওয়েবসাইট শুরু করুন',
  'Talk to a consultant': 'পরামর্শকের সাথে কথা বলুন',
  'Talk to our team': 'আমাদের টিমের সাথে কথা বলুন',
  'Request a custom quote': 'কাস্টম কোটেশন চান',
  'Request a callback': 'কলব্যাক চান',
  'Request callback': 'কলব্যাক চান',
  'See packages': 'প্যাকেজ দেখুন',
  'View full portfolio': 'পুরো পোর্টফোলিও দেখুন',
  'See all questions': 'সব প্রশ্ন দেখুন',
  'Browse all services': 'সব সার্ভিস দেখুন',
  'Compare packages': 'প্যাকেজ তুলনা করুন',
  'Compare all packages': 'সব প্যাকেজ তুলনা করুন',
  'See full feature list': 'পুরো ফিচার তালিকা দেখুন',
  'What you get': 'আপনি যা পাবেন',
  'You own everything': 'সবকিছুর মালিক আপনি',
  'Add a service on top of any package': 'যেকোনো প্যাকেজের সাথে সার্ভিস যোগ করুন',
  'Support in Bangla': 'বাংলায় সাপোর্ট',
  'SSLCommerz certified': 'SSLCommerz সার্টিফায়েড',
  'One-click courier booking': 'এক ক্লিকে কুরিয়ার বুকিং',
  'Not sure / other': 'নিশ্চিত নই / অন্যান্য',
  'Not sure yet': 'এখনো নিশ্চিত নই',

  // ============================================================
  // Stats & labels
  // ============================================================
  'Starting from': 'শুরু',
  'Starting price': 'শুরুর মূল্য',
  'per month': 'প্রতি মাসে',
  'one-time': 'একবার',
  'BDT one-time': 'টাকা (একবার)',
  Delivery: 'ডেলিভারি',
  Revisions: 'রিভিশন',
  days: 'দিন',
  'days delivery': 'দিনে ডেলিভারি',
  Billing: 'বিলিং',
  Monthly: 'মাসিক',
  Yearly: 'বার্ষিক',
  Category: 'ক্যাটাগরি',
  'All categories': 'সব ক্যাটাগরি',
  Filters: 'ফিল্টার',
  From: 'থেকে',
  Hours: 'সময়',
  Office: 'অফিস',
  Phone: 'ফোন',
  Email: 'ইমেইল',
  'Email address': 'ইমেইল ঠিকানা',
  'Best time to call': 'কল করার ভালো সময়',
  'Average go-live': 'গড়ে লাইভ হয়',
  'Average load time': 'গড় লোড সময়',
  'Active clients': 'সক্রিয় ক্লায়েন্ট',
  'Businesses served': 'সেবা দেওয়া প্রতিষ্ঠান',
  'Websites delivered': 'ডেলিভারি করা ওয়েবসাইট',
  'Projects delivered': 'ডেলিভারি করা প্রজেক্ট',
  'Sites live today': 'আজ লাইভ সাইট',
  'Districts covered': 'কভার করা জেলা',
  'Live websites in portfolio': 'পোর্টফোলিওতে লাইভ ওয়েবসাইট',
  'Client revenue generated': 'ক্লায়েন্টের আয়',
  'E-commerce builds': 'ই-কমার্স বিল্ড',
  'Fake order protection': 'ফেক অর্ডার সুরক্ষা',
  'All the local payment rails, wired up': 'সব লোকাল পেমেন্ট মাধ্যম, যুক্ত করা',
  'Free trial': 'ফ্রি ট্রায়াল',

  // ============================================================
  // Services & packages
  // ============================================================
  'All services': 'সব সার্ভিস',
  'All packages': 'সব প্যাকেজ',
  'What is included': 'যা যা অন্তর্ভুক্ত',
  'Not included': 'যা অন্তর্ভুক্ত নয়',
  'Not included in this tier': 'এই প্যাকেজে অন্তর্ভুক্ত নয়',
  'Add-ons': 'অ্যাড-অন',
  Features: 'ফিচার',
  'No packages yet': 'এখনো কোনো প্যাকেজ নেই',
  'No services yet': 'এখনো কোনো সার্ভিস নেই',
  'Search services': 'সার্ভিস খুঁজুন',
  'No services matched that search': 'সেই খোঁজে কোনো সার্ভিস মেলেনি',
  'Most popular': 'সবচেয়ে জনপ্রিয়',
  'One-time': 'একবার',
  'One-time purchase': 'একবারের ক্রয়',
  'One-time setup fee': 'একবারের সেটআপ ফি',
  'Often ordered with this': 'এর সাথে সাধারণত নেওয়া হয়',
  'Order this package': 'এই প্যাকেজ অর্ডার করুন',
  'Order a package': 'প্যাকেজ অর্ডার করুন',
  'Order a website': 'ওয়েবসাইট অর্ডার করুন',
  'Order now': 'এখনই অর্ডার করুন',
  Choose: 'নিন',

  // ============================================================
  // Portfolio & blog
  // ============================================================
  'All work': 'সব কাজ',
  'All posts': 'সব লেখা',
  'No work published yet': 'এখনো কোনো কাজ প্রকাশিত হয়নি',
  'No posts yet': 'এখনো কোনো লেখা নেই',
  Published: 'প্রকাশিত',
  Tags: 'ট্যাগ',
  Share: 'শেয়ার',
  'Stores and sites we have shipped': 'আমাদের ডেলিভারি করা স্টোর ও সাইট',
  'Portfolio coming soon': 'পোর্টফোলিও শীঘ্রই আসছে',
  'Want a store like one of these?': 'এরকম একটি স্টোর চান?',

  // ============================================================
  // Contact form & about
  // ============================================================
  'Your name': 'আপনার নাম',
  'Your email': 'আপনার ইমেইল',
  'Your phone': 'আপনার ফোন',
  'Mobile number': 'মোবাইল নম্বর',
  Company: 'প্রতিষ্ঠান',
  'Business name': 'প্রতিষ্ঠানের নাম',
  'Business type': 'প্রতিষ্ঠানের ধরন',
  'Contact person': 'যোগাযোগ ব্যক্তি',
  District: 'জেলা',
  'Budget range': 'বাজেট পরিসীমা',
  Message: 'বার্তা',
  'Message us': 'আমাদের বার্তা দিন',
  'Tell us about your project': 'আপনার প্রকল্প সম্পর্কে জানান',
  'Tell us what you are trying to sell': 'আপনি কী বিক্রি করতে চান, জানান',
  'Tell us what to build': 'কী বানাতে চান, জানান',
  'What do you need?': 'আপনার কী প্রয়োজন?',
  'What do you need built?': 'কী বানাতে চান?',
  'Send message': 'বার্তা পাঠান',
  'Send us a message': 'আমাদের বার্তা পাঠান',
  'Direct lines': 'সরাসরি যোগাযোগ',
  'Quick answers': 'দ্রুত উত্তর',
  'We usually reply within one business day': 'আমরা সাধারণত এক কর্মদিবসের মধ্যে উত্তর দিই',
  'Your name is required': 'আপনার নাম প্রয়োজন',
  'A valid phone number is required': 'সঠিক ফোন নম্বর প্রয়োজন',
  'Reach us': 'আমাদের সাথে যোগাযোগ',
  'Why we exist': 'আমরা কেন আছি',
  'How we work': 'আমরা কীভাবে কাজ করি',

  // ============================================================
  // Checkout & order
  // ============================================================
  'Order summary': 'অর্ডারের সারসংক্ষেপ',
  'Order placed': 'অর্ডার সম্পন্ন',
  'Order number': 'অর্ডার নম্বর',
  Subtotal: 'সাবটোটাল',
  Total: 'মোট',
  'Total payable': 'মোট পরিশোধযোগ্য',
  'Update summary': 'সারসংক্ষেপ হালনাগাদ করুন',
  VAT: 'ভ্যাট',
  Discount: 'ছাড়',
  Coupon: 'কুপন',
  'Coupon code': 'কুপন কোড',
  'Pay now': 'এখনই পরিশোধ করুন',
  'Payment method': 'পেমেন্ট মাধ্যম',
  'Payment mode': 'পেমেন্ট মাধ্যম',
  'Place order': 'অর্ডার করুন',
  'Project name': 'প্রকল্পের নাম',
  'Project / business name': 'প্রকল্প / প্রতিষ্ঠানের নাম',
  'Preferred domain': 'পছন্দের ডোমেইন',
  'Your project': 'আপনার প্রকল্প',
  'Your details': 'আপনার তথ্য',
  Package: 'প্যাকেজ',

  // ============================================================
  // Account
  // ============================================================
  'My orders': 'আমার অর্ডার',
  'My website': 'আমার ওয়েবসাইট',
  'My profile': 'আমার প্রোফাইল',
  Subscriptions: 'সাবস্ক্রিপশন',
  Invoices: 'ইনভয়েস',
  Payments: 'পেমেন্ট',
  'Support tickets': 'সাপোর্ট টিকেট',
  'Buy a package': 'প্যাকেজ কিনুন',
  'No orders yet': 'এখনো কোনো অর্ডার নেই',
  'No invoices yet': 'এখনো কোনো ইনভয়েস নেই',
  'Nothing owed — thank you': 'কিছু বাকি নেই — ধন্যবাদ',
  'Manage subscription': 'সাবস্ক্রিপশন ব্যবস্থাপনা',

  // ============================================================
  // Status
  // ============================================================
  Pending: 'অপেক্ষমাণ',
  'In progress': 'চলমান',
  Completed: 'সম্পন্ন',
  Cancelled: 'বাতিল',
  Paid: 'পরিশোধিত',
  Unpaid: 'অপরিশোধিত',
  Overdue: 'মেয়াদোত্তীর্ণ',
  Active: 'সক্রিয়',
  Inactive: 'নিষ্ক্রিয়',
  Open: 'খোলা',
  Closed: 'বন্ধ',
  Draft: 'খসড়া',
  Verified: 'যাচাইকৃত',

  // ============================================================
  // Footer
  // ============================================================
  'Quick links': 'দ্রুত লিংক',
  Support: 'সাপোর্ট',
  'Bank transfer': 'ব্যাংক ট্রান্সফার',
  'Cash on delivery': 'ক্যাশ অন ডেলিভারি',
  SSLCommerz: 'এসএসএলকমার্জ',
  Rocket: 'রকেট',
  bKash: 'বিকাশ',
  Nagad: 'নগদ',
  Pathao: 'পাঠাও',
  'We accept': 'আমরা গ্রহণ করি',
  'All rights reserved': 'সর্বস্বত্ব সংরক্ষিত',
  'Privacy policy': 'গোপনীয়তা নীতি',
  'Terms of service': 'সেবার শর্তাবলী',
  'Refund policy': 'ফেরত নীতি',
  Facebook: 'ফেসবুক',
  YouTube: 'ইউটিউব',
  LinkedIn: 'লিংকডইন',
  WhatsApp: 'হোয়াটসঅ্যাপ',

  // ============================================================
  // Admin sidebar (staff-facing, translated for consistency)
  // ============================================================
  Overview: 'সারসংক্ষেপ',
  Sales: 'বিক্রয়',
  Catalogue: 'ক্যাটালগ',
  Content: 'কনটেন্ট',
  System: 'সিস্টেম',
  Reports: 'রিপোর্ট',
  Orders: 'অর্ডার',
  Leads: 'লিড',
  Coupons: 'কুপন',
  Users: 'ইউজার',
  Projects: 'প্রজেক্ট',
  Tickets: 'টিকেট',
  Testimonials: 'রিভিউ',
  Settings: 'সেটিংস',
  'Activity log': 'অ্যাক্টিভিটি লগ',
  'Media library': 'মিডিয়া লাইব্রেরি',
  'Admin panel': 'অ্যাডমিন প্যানেল',
  Browse: 'ব্রাউজ',
  Upload: 'আপলোড',
  Remove: 'সরান',
  'No image': 'কোনো ছবি নেই',

  // ============================================================
  // Misc
  // ============================================================
  Loading: 'লোড হচ্ছে',
  'No results': 'কোনো ফলাফল নেই',
  'Something went wrong': 'কিছু ভুল হয়েছে',
  'Page not found': 'পেজ পাওয়া যায়নি',
  'Access denied': 'প্রবেশাধিকার নেই',
  'Server error': 'সার্ভার ত্রুটি',
  'Back to home': 'হোমে ফিরে যান',
  'Try again': 'আবার চেষ্টা করুন',
  'Welcome back': 'স্বাগতম',
  'Bangladesh web studio': 'বাংলাদেশের ওয়েব স্টুডিও',
};

/**
 * Look up a UI string. Returns the Bangla value when the language is bn and a
 * translation exists; otherwise returns the English key unchanged.
 */
function translate(key, lang) {
  if (lang !== 'bn') return key;
  return Object.prototype.hasOwnProperty.call(BN, key) ? BN[key] : key;
}

module.exports = { BN, translate };
