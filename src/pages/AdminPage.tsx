import { useLocation } from "react-router-dom";
import { Dashboard } from "../admin/sections/Dashboard";
import { Users } from "../admin/sections/Users";
import { Organizations } from "../admin/sections/Organizations";
import { Campaigns } from "../admin/sections/Campaigns";
import { Requests } from "../admin/sections/Requests";
import { RewardsAnalyticsAdmin } from "../admin/sections/RewardsAnalytics";
import { SeasonsAdmin } from "../admin/sections/Seasons";
import { Ads } from "../admin/sections/Ads";
import { Audit } from "../admin/sections/Audit";
import "../styles/v14-admin.css";
import "../styles/v14.5-ad-campaign-management.css";
import "../styles/admin-tokens.css";
import "../styles/v15.10-admin-partner-economy.css";

export function AdminPage() {
  const path = useLocation().pathname;
  if (path === "/admin/users") return <Users />;
  if (path === "/admin/organizations") return <Organizations />;
  if (path === "/admin/brands") return <Organizations brandsOnly />;
  if (path === "/admin/campaigns") return <Campaigns />;
  if (path === "/admin/requests") return <Requests />;
  if (path === "/admin/rewards") return <RewardsAnalyticsAdmin />;
  if (path === "/admin/seasons") return <SeasonsAdmin />;
  if (path === "/admin/ads") return <Ads />;
  if (path === "/admin/audit") return <Audit />;
  return <Dashboard />;
}
