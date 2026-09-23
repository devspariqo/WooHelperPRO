'use strict';

/**
 * Shared domain constants, labels (English + Bangla) and small helpers.
 * Everything user-facing that is repeated across views lives here so the
 * Bangla copy stays consistent.
 */

const ROLES = {
  SUPER_ADMIN: 'Super Admin',
  ADMIN: 'Admin',
  MANAGER: 'Manager',
  STAFF: 'Staff',
  SUPPORT: 'Support',
  CUSTOMER: 'Customer',
};

/**
 * Everyone who is NOT a customer -- i.e. has some level of staff access.
 *
 * Kept as one list so "show me the staff" has a single definition. The admin
 * users list, the sidebar, and any future staff-only reporting all read this
 * rather than each re-listing the five roles and drifting apart.
 */
const STAFF_ROLES = ['SUPER_ADMIN', 'ADMIN', 'MANAGER', 'STAFF', 'SUPPORT'];

const ROLES_BN = {
  SUPER_ADMIN: 'সুপার অ্যাডমিন',
  ADMIN: 'অ্যাডমিন',
  MANAGER: 'ম্যানেজার',
  STAFF: 'স্টাফ',
  SUPPORT: 'সাপোর্ট',
  CUSTOMER: 'কাস্টমার',
};

/** Account lifecycle states (User.status). */
const USER_STATUS = {
  ACTIVE: { en: 'Active', bn: 'সক্রিয়', tone: 'success' },
  PENDING: { en: 'Pending', bn: 'পেন্ডিং', tone: 'warn' },
  INACTIVE: { en: 'Inactive', bn: 'নিষ্ক্রিয়', tone: 'muted' },
  SUSPENDED: { en: 'Suspended', bn: 'স্থগিত', tone: 'danger' },
};

/** Identity verification states (User.kycStatus). */
const KYC_STATUS = {
  NOT_SUBMITTED: { en: 'Not submitted', bn: 'জমা দেওয়া হয়নি', tone: 'muted' },
  PENDING: { en: 'Pending review', bn: 'রিভিউতে', tone: 'warn' },
  VERIFIED: { en: 'Verified', bn: 'যাচাই হয়েছে', tone: 'success' },
  REJECTED: { en: 'Rejected', bn: 'প্রত্যাখ্যাত', tone: 'danger' },
};

const ORDER_STATUS = {
  PENDING: { en: 'Pending', bn: 'পেন্ডিং', tone: 'warn' },
  AWAITING_PAYMENT: { en: 'Awaiting Payment', bn: 'পেমেন্টের অপেক্ষায়', tone: 'warn' },
  PAYMENT_VERIFIED: { en: 'Payment Verified', bn: 'পেমেন্ট যাচাই হয়েছে', tone: 'info' },
  IN_REVIEW: { en: 'In Review', bn: 'রিভিউতে', tone: 'info' },
  IN_PROGRESS: { en: 'In Progress', bn: 'কাজ চলছে', tone: 'info' },
  CLIENT_REVIEW: { en: 'Client Review', bn: 'ক্লায়েন্ট রিভিউ', tone: 'info' },
  REVISION: { en: 'Revision', bn: 'রিভিশন', tone: 'warn' },
  COMPLETED: { en: 'Completed', bn: 'সম্পন্ন', tone: 'success' },
  DELIVERED: { en: 'Delivered', bn: 'ডেলিভার হয়েছে', tone: 'success' },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল', tone: 'danger' },
  REFUNDED: { en: 'Refunded', bn: 'রিফান্ড', tone: 'danger' },
  ON_HOLD: { en: 'On Hold', bn: 'স্থগিত', tone: 'muted' },
};

const PAYMENT_STATUS = {
  UNPAID: { en: 'Unpaid', bn: 'অপরিশোধিত', tone: 'danger' },
  PARTIAL: { en: 'Partially Paid', bn: 'আংশিক পরিশোধিত', tone: 'warn' },
  PAID: { en: 'Paid', bn: 'পরিশোধিত', tone: 'success' },
  FAILED: { en: 'Failed', bn: 'ব্যর্থ', tone: 'danger' },
  REFUNDED: { en: 'Refunded', bn: 'রিফান্ড', tone: 'muted' },
};

const SUBSCRIPTION_STATUS = {
  TRIALING: { en: 'Trialing', bn: 'ট্রায়াল', tone: 'info' },
  ACTIVE: { en: 'Active', bn: 'সক্রিয়', tone: 'success' },
  PAST_DUE: { en: 'Past Due', bn: 'বিলম্বিত', tone: 'warn' },
  PAUSED: { en: 'Paused', bn: 'বিরত', tone: 'muted' },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল', tone: 'danger' },
  EXPIRED: { en: 'Expired', bn: 'মেয়াদ শেষ', tone: 'danger' },
};

const INVOICE_STATUS = {
  DRAFT: { en: 'Draft', bn: 'খসড়া', tone: 'muted' },
  SENT: { en: 'Sent', bn: 'পাঠানো', tone: 'info' },
  PARTIALLY_PAID: { en: 'Partially Paid', bn: 'আংশিক', tone: 'warn' },
  PAID: { en: 'Paid', bn: 'পরিশোধিত', tone: 'success' },
  OVERDUE: { en: 'Overdue', bn: 'মেয়াদোত্তীর্ণ', tone: 'danger' },
  VOID: { en: 'Void', bn: 'বাতিল', tone: 'muted' },
  REFUNDED: { en: 'Refunded', bn: 'রিফান্ড', tone: 'muted' },
};

const TICKET_STATUS = {
  OPEN: { en: 'Open', bn: 'খোলা', tone: 'warn' },
  IN_PROGRESS: { en: 'In Progress', bn: 'চলছে', tone: 'info' },
  WAITING_CUSTOMER: { en: 'Waiting Customer', bn: 'কাস্টমারের অপেক্ষায়', tone: 'warn' },
  RESOLVED: { en: 'Resolved', bn: 'সমাধান', tone: 'success' },
  CLOSED: { en: 'Closed', bn: 'বন্ধ', tone: 'muted' },
};

const PROJECT_STATUS = {
  NOT_STARTED: { en: 'Not Started', bn: 'শুরু হয়নি', tone: 'muted', progress: 0 },
  DESIGNING: { en: 'Designing', bn: 'ডিজাইনিং', tone: 'info', progress: 20 },
  DEVELOPMENT: { en: 'Development', bn: 'ডেভেলপমেন্ট', tone: 'info', progress: 50 },
  CLIENT_REVIEW: { en: 'Client Review', bn: 'ক্লায়েন্ট রিভিউ', tone: 'warn', progress: 70 },
  REVISION: { en: 'Revision', bn: 'রিভিশন', tone: 'warn', progress: 75 },
  TESTING: { en: 'Testing', bn: 'টেস্টিং', tone: 'info', progress: 90 },
  LAUNCHED: { en: 'Launched', bn: 'লাইভ', tone: 'success', progress: 100 },
  MAINTENANCE: { en: 'Maintenance', bn: 'মেইনটেন্যান্স', tone: 'success', progress: 100 },
  ON_HOLD: { en: 'On Hold', bn: 'স্থগিত', tone: 'muted', progress: 0 },
  CANCELLED: { en: 'Cancelled', bn: 'বাতিল', tone: 'danger', progress: 0 },
};

const BILLING_CYCLE = {
  ONE_TIME: { en: 'One Time', bn: 'এককালীন', months: 0 },
  MONTHLY: { en: 'Monthly', bn: 'মাসিক', months: 1 },
  QUARTERLY: { en: 'Quarterly', bn: 'ত্রৈমাসিক', months: 3 },
  HALF_YEARLY: { en: 'Half Yearly', bn: 'ষাণ্মাসিক', months: 6 },
  YEARLY: { en: 'Yearly', bn: 'বার্ষিক', months: 12 },
};

const PAYMENT_METHOD = {
  BKASH: { en: 'bKash', bn: 'বিকাশ' },
  NAGAD: { en: 'Nagad', bn: 'নগদ' },
  ROCKET: { en: 'Rocket', bn: 'রকেট' },
  SSLCOMMERZ: { en: 'SSLCommerz', bn: 'এসএসএলকমার্জ' },
  UPAY: { en: 'Upay', bn: 'উপায়' },
  SURECASH: { en: 'SureCash', bn: 'শিওরক্যাশ' },
  BANK_TRANSFER: { en: 'Bank Transfer', bn: 'ব্যাংক ট্রান্সফার' },
  CASH: { en: 'Cash', bn: 'নগদ' },
  CARD: { en: 'Card', bn: 'কার্ড' },
  MANUAL: { en: 'Manual', bn: 'ম্যানুয়াল' },
};

const PACKAGE_TIER = {
  STARTER: { en: 'Starter', bn: 'স্টার্টার', tone: 'muted' },
  BASIC: { en: 'Basic', bn: 'বেসিক', tone: 'info' },
  PROFESSIONAL: { en: 'Professional', bn: 'প্রফেশনাল', tone: 'info' },
  BUSINESS: { en: 'Business', bn: 'বিজনেস', tone: 'success' },
  ENTERPRISE: { en: 'Enterprise', bn: 'এন্টারপ্রাইজ', tone: 'danger' },
  CUSTOM: { en: 'Custom', bn: 'কাস্টম', tone: 'muted' },
};

/** All 64 districts of Bangladesh, with Bangla names. */
const DISTRICTS = [
  ['Dhaka', 'ঢাকা'], ['Gazipur', 'গাজীপুর'], ['Narayanganj', 'নারায়ণগঞ্জ'], ['Tangail', 'টাঙ্গাইল'],
  ['Kishoreganj', 'কিশোরগঞ্জ'], ['Manikganj', 'মানিকগঞ্জ'], ['Munshiganj', 'মুন্সিগঞ্জ'], ['Narsingdi', 'নরসিংদী'],
  ['Faridpur', 'ফরিদপুর'], ['Gopalganj', 'গোপালগঞ্জ'], ['Madaripur', 'মাদারীপুর'], ['Rajbari', 'রাজবাড়ী'],
  ['Shariatpur', 'শরীয়তপুর'], ['Chattogram', 'চট্টগ্রাম'], ['Coxs Bazar', "কক্সবাজার"], ['Cumilla', 'কুমিল্লা'],
  ['Brahmanbaria', 'ব্রাহ্মণবাড়িয়া'], ['Chandpur', 'চাঁদপুর'], ['Feni', 'ফেনী'], ['Noakhali', 'নোয়াখালী'],
  ['Lakshmipur', 'লক্ষ্মীপুর'], ['Rangamati', 'রাঙ্গামাটি'], ['Bandarban', 'বান্দরবান'], ['Khagrachhari', 'খাগড়াছড়ি'],
  ['Sylhet', 'সিলেট'], ['Moulvibazar', 'মৌলভীবাজার'], ['Habiganj', 'হবিগঞ্জ'], ['Sunamganj', 'সুনামগঞ্জ'],
  ['Rajshahi', 'রাজশাহী'], ['Bogura', 'বগুড়া'], ['Pabna', 'পাবনা'], ['Sirajganj', 'সিরাজগঞ্জ'],
  ['Natore', 'নাটোর'], ['Joypurhat', 'জয়পুরহাট'], ['Naogaon', 'নওগাঁ'], ['Chapainawabganj', 'চাঁপাইনবাবগঞ্জ'],
  ['Rangpur', 'রংপুর'], ['Dinajpur', 'দিনাজপুর'], ['Gaibandha', 'গাইবান্ধা'], ['Kurigram', 'কুড়িগ্রাম'],
  ['Lalmonirhat', 'লালমনিরহাট'], ['Nilphamari', 'নীলফামারী'], ['Panchagarh', 'পঞ্চগড়'], ['Thakurgaon', 'ঠাকুরগাঁও'],
  ['Khulna', 'খুলনা'], ['Jashore', 'যশোর'], ['Kushtia', 'কুষ্টিয়া'], ['Satkhira', 'সাতক্ষীরা'],
  ['Bagerhat', 'বাগেরহাট'], ['Chuadanga', 'চুয়াডাঙ্গা'], ['Jhenaidah', 'ঝিনাইদহ'], ['Magura', 'মাগুরা'],
  ['Meherpur', 'মেহেরপুর'], ['Narail', 'নড়াইল'], ['Barishal', 'বরিশাল'], ['Bhola', 'ভোলা'],
  ['Barguna', 'বরগুনা'], ['Jhalokati', 'ঝালকাঠি'], ['Patuakhali', 'পটুয়াখালী'], ['Pirojpur', 'পিরোজপুর'],
  ['Mymensingh', 'ময়মনসিংহ'], ['Jamalpur', 'জামালপুর'], ['Netrokona', 'নেত্রকোণা'], ['Sherpur', 'শেরপুর'],
];

const BUSINESS_TYPES = [
  'Fashion & Clothing', 'Gadgets & Electronics', 'Cosmetics & Beauty', 'Organic Food & Grocery',
  'Home Decor & Furniture', 'Islamic Products', 'Books & Stationery', 'Gift Items',
  'Digital Products', 'Fitness & Supplements', 'Restaurant & Food Delivery', 'Pharmacy & Health',
  'Jewelry', 'Kids & Toys', 'Pet Supplies', 'Other',
];

const LEAD_STATUS = {
  NEW: { en: 'New', bn: 'নতুন', tone: 'warn' },
  CONTACTED: { en: 'Contacted', bn: 'যোগাযোগ হয়েছে', tone: 'info' },
  QUALIFIED: { en: 'Qualified', bn: 'যোগ্য', tone: 'info' },
  CONVERTED: { en: 'Converted', bn: 'কনভার্টেড', tone: 'success' },
  LOST: { en: 'Lost', bn: 'হারানো', tone: 'danger' },
};

const TICKET_CATEGORIES = [
  'GENERAL', 'BILLING', 'TECHNICAL', 'DESIGN_CHANGE', 'HOSTING', 'DOMAIN', 'DELIVERY', 'REFUND',
];

const SUPPORT_ADDONS = [
  { name: 'Extra Landing Page', nameBn: 'অতিরিক্ত ল্যান্ডিং পেজ', price: 2500, cycle: 'ONE_TIME' },
  { name: 'Managed Hosting + SSL', nameBn: 'ম্যানেজড হোস্টিং + SSL', price: 1200, cycle: 'MONTHLY' },
  { name: 'Monthly SEO Boost', nameBn: 'মাসিক এসইও বুস্ট', price: 6000, cycle: 'MONTHLY' },
  { name: 'Facebook Ads Management', nameBn: 'ফেসবুক অ্যাডস ম্যানেজমেন্ট', price: 8000, cycle: 'MONTHLY' },
  { name: 'Priority Support (4h SLA)', nameBn: 'প্রায়োরিটি সাপোর্ট (৪ ঘণ্টা)', price: 3000, cycle: 'MONTHLY' },
  { name: 'Courier API Integration (Pathao/Steadfast)', nameBn: 'কুরিয়ার এপিআই ইন্টিগ্রেশন', price: 7000, cycle: 'ONE_TIME' },
];

module.exports = {
  ROLES, ROLES_BN, STAFF_ROLES, USER_STATUS, KYC_STATUS,
  ORDER_STATUS, PAYMENT_STATUS, SUBSCRIPTION_STATUS, INVOICE_STATUS,
  TICKET_STATUS, PROJECT_STATUS, BILLING_CYCLE, PAYMENT_METHOD,
  PACKAGE_TIER, LEAD_STATUS,
  DISTRICTS, BUSINESS_TYPES, TICKET_CATEGORIES, SUPPORT_ADDONS,
};
