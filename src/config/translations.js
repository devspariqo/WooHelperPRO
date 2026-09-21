'use strict';

/**
 * UI string dictionary: English -> Bangla.
 *
 * The `Bn` columns in the database cover CONTENT (service titles, package names,
 * blog posts). They never covered the chrome -- buttons, headings, form labels,
 * empty states -- which was all hardcoded English in the views. That is why
 * setting the language to Bangla left most of the page in English.
 *
 * This dictionary fills that gap. Views call t('Add to cart') and get the Bangla
 * string when the language is bn.
 *
 * Conventions:
 *  - Keys are the exact English source string, so a view reads naturally and an
 *    untranslated string simply falls through to English rather than showing a key.
 *  - Keep keys short and stable. Changing a key means updating its call sites.
 *  - Group by area so it is obvious where a new string belongs.
 */

const BN = {
  // ---- Navigation & chrome ----
  Home: 'হোম',
  Services: 'সার্ভিস',
  Packages: 'প্যাকেজ',
  Portfolio: 'পোর্টফোলিও',
  Blog: 'ব্লগ',
  About: 'আমাদের সম্পর্কে',
  Pricing: 'মূল্য',
  Contact: 'যোগাযোগ',
  FAQs: 'সাধারণ প্রশ্ন',
  Login: 'লগ ইন',
  Logout: 'লগ আউট',
  Register: 'নিবন্ধন',
  'Sign in': 'সাইন ইন',
  'Sign out': 'সাইন আউট',
  Dashboard: 'ড্যাশবোর্ড',
  'My account': 'আমার অ্যাকাউন্ট',
  'Back to website': 'ওয়েবসাইটে ফিরে যান',
  'View website': 'ওয়েবসাইট দেখুন',
  'Toggle theme': 'থিম পরিবর্তন',
  'Switch language': 'ভাষা পরিবর্তন',
  Menu: 'মেনু',

  // ---- Common actions ----
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
  'Get started': 'শুরু করুন',
  'Choose this package': 'এই প্যাকেজ নিন',
  'Request this': 'অনুরোধ করুন',
  'Start this service': 'এই সার্ভিস নিন',
  'Contact us': 'যোগাযোগ করুন',
  'Talk to us': 'কথা বলুন',

  // ---- Homepage ----
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
  'Starting from': 'শুরু',
  'per month': 'প্রতি মাসে',
  'one-time': 'একবার',
  'Delivery': 'ডেলিভারি',
  'days': 'দিন',
  'days delivery': 'দিনে ডেলিভারি',

  // ---- Services / packages ----
  'All services': 'সব সার্ভিস',
  'All packages': 'সব প্যাকেজ',
  'What is included': 'যা যা অন্তর্ভুক্ত',
  'Not included': 'যা অন্তর্ভুক্ত নয়',
  'Add-ons': 'অ্যাড-অন',
  'Features': 'ফিচার',
  'Compare packages': 'প্যাকেজ তুলনা',
  'No packages yet': 'এখনো কোনো প্যাকেজ নেই',
  'No services yet': 'এখনো কোনো সার্ভিস নেই',

  // ---- Portfolio / blog ----
  'All work': 'সব কাজ',
  'All posts': 'সব লেখা',
  'No work published yet': 'এখনো কোনো কাজ প্রকাশিত হয়নি',
  'No posts yet': 'এখনো কোনো লেখা নেই',
  'Published': 'প্রকাশিত',
  'Category': 'ক্যাটাগরি',
  'Tags': 'ট্যাগ',
  'Share': 'শেয়ার',

  // ---- Contact form ----
  'Your name': 'আপনার নাম',
  'Your email': 'আপনার ইমেইল',
  'Your phone': 'আপনার ফোন',
  'Company': 'প্রতিষ্ঠান',
  'District': 'জেলা',
  'Message': 'বার্তা',
  'Tell us about your project': 'আপনার প্রকল্প সম্পর্কে জানান',
  'Send message': 'বার্তা পাঠান',
  'We usually reply within one business day':
    'আমরা সাধারণত এক কর্মদিবসের মধ্যে উত্তর দিই',
  'Your name is required': 'আপনার নাম প্রয়োজন',
  'A valid phone number is required': 'সঠিক ফোন নম্বর প্রয়োজন',

  // ---- Checkout / order ----
  'Order summary': 'অর্ডারের সারসংক্ষেপ',
  'Order placed': 'অর্ডার সম্পন্ন',
  'Subtotal': 'সাবটোটাল',
  'Total': 'মোট',
  'VAT': 'ভ্যাট',
  'Discount': 'ছাড়',
  'Pay now': 'এখনই পরিশোধ করুন',
  'Payment method': 'পেমেন্ট মাধ্যম',
  'Place order': 'অর্ডার করুন',
  'Order number': 'অর্ডার নম্বর',
  'Project name': 'প্রকল্পের নাম',

  // ---- Account ----
  'My orders': 'আমার অর্ডার',
  'My website': 'আমার ওয়েবসাইট',
  'My profile': 'আমার প্রোফাইল',
  'Subscriptions': 'সাবস্ক্রিপশন',
  'Invoices': 'ইনভয়েস',
  'Payments': 'পেমেন্ট',
  'Support tickets': 'সাপোর্ট টিকেট',
  'Buy a package': 'প্যাকেজ কিনুন',
  'No orders yet': 'এখনো কোনো অর্ডার নেই',
  'No invoices yet': 'এখনো কোনো ইনভয়েস নেই',
  'Nothing owed — thank you': 'কিছু বাকি নেই — ধন্যবাদ',

  // ---- Status ----
  'Pending': 'অপেক্ষমাণ',
  'In progress': 'চলমান',
  'Completed': 'সম্পন্ন',
  'Cancelled': 'বাতিল',
  'Paid': 'পরিশোধিত',
  'Unpaid': 'অপরিশোধিত',
  'Overdue': 'মেয়াদোত্তীর্ণ',
  'Active': 'সক্রিয়',
  'Inactive': 'নিষ্ক্রিয়',
  'Open': 'খোলা',
  'Closed': 'বন্ধ',
  'Draft': 'খসড়া',
  'Verified': 'যাচাইকৃত',

  // ---- Footer ----
  'Quick links': 'দ্রুত লিংক',
  'Support': 'সাপোর্ট',
  'Our work': 'আমাদের কাজ',
  'About us': 'আমাদের সম্পর্কে',
  'Manage subscription': 'সাবস্ক্রিপশন ব্যবস্থাপনা',
  'System status': 'সিস্টেম স্ট্যাটাস',
  'Bank transfer': 'ব্যাংক ট্রান্সফার',
  'Cash on delivery': 'ক্যাশ অন ডেলিভারি',
  'SSLCommerz': 'এসএসএলকমার্জ',
  'We accept': 'আমরা গ্রহণ করি',
  'All rights reserved': 'সর্বস্বত্ব সংরক্ষিত',
  'Privacy policy': 'গোপনীয়তা নীতি',
  'Terms of service': 'সেবার শর্তাবলী',
  'Refund policy': 'ফেরত নীতি',

  // ---- Misc ----
  'Loading': 'লোড হচ্ছে',
  'No results': 'কোনো ফলাফল নেই',
  'Something went wrong': 'কিছু ভুল হয়েছে',
  'Page not found': 'পেজ পাওয়া যায়নি',
  'Access denied': 'প্রবেশাধিকার নেই',
  'Server error': 'সার্ভার ত্রুটি',
  'Back to home': 'হোমে ফিরে যান',
  'Try again': 'আবার চেষ্টা করুন',
};

/**
 * Look up a UI string. Returns the Bangla value when the language is bn and a
 * translation exists; otherwise returns the English key unchanged.
 *
 * Returning the key on a miss is deliberate: an untranslated string shows English
 * rather than a placeholder like "nav.services", which is far more useful to a
 * reader and to whoever is finishing the translation.
 */
function translate(key, lang) {
  if (lang !== 'bn') return key;
  return Object.prototype.hasOwnProperty.call(BN, key) ? BN[key] : key;
}

module.exports = { BN, translate };
