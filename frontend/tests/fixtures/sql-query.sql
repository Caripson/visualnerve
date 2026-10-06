-- Fictional service-contract report. Comments must not enter diagram metadata.
SELECT DISTINCT
  b.bu_id, b.bu_name, sales_rep.emp_name AS sales_rep,
  inv_sales_rep.emp_name AS invoice_sales_rep,
  b.bu_company_number AS org_nr, invoice_org.bu_id AS invoice_bu_id,
  invoice_org.bu_name AS invoice_name, parent_org.bu_name AS parent_name,
  invoice_parent.bu_name AS invoice_parent_name,
  l.line_id,
  l.line_contract_expiry_date::string::date AS line_contract_expiry_date,
  l.line_last_invoice_date::string::date AS invoiced_up_to,
  inv_tmp.prev_invoice_date::string::date AS prev_invoice_date,
  inv_tmp.prev_invoice_due_date::string::date AS prev_invoice_due_date,
  CASE WHEN cm.ctymem_cty_id IS NOT NULL AND cm.ctymem_cty_id = 1071 THEN 1 ELSE 0 END AS aksess,
  CASE WHEN pc.prod_price_duration_unit LIKE 'month' THEN l.line_periodic_amount
       WHEN pc.prod_price_duration_unit LIKE 'quarter' THEN l.line_periodic_amount / 3
       WHEN pc.prod_price_duration_unit LIKE 'year' THEN l.line_periodic_amount / 12
       ELSE 0 END AS line_mrc,
  CASE WHEN conn_mrc.connection_mrc IS NULL THEN l.line_periodic_amount
       ELSE conn_mrc.connection_mrc END AS connection_mrc,
  l.line_conn_id, l.line_status,
  l.line_real_rfs_date::string::date AS line_real_rfs_date,
  l.line_real_cfs_date::string::date AS line_real_rfs_date,
  st.status_category, p.product_int_service_type,
  cm2.ctymem_value AS exchange, tech.cty_name AS tech,
  cm4.ctymem_value AS vpn_name, samband.eci_ext_circuit_id,
  sales_rep.emp_segment AS bi_team, inv_sales_rep.emp_segment AS invoice_bi_team,
  cust_contact.emp_email AS cust_contact_email,
  inv_cust_contact.emp_email AS invoice_cust_contact_email,
  c1.VAT_NUMBER_TOP top_org, c2.VAT_NUMBER_TOP invoice_top_org,
  c3.VAT_NUMBER_TOP parent_top_org
FROM DEMO_WAREHOUSE.REPORTS.SERVICE_CONTRACTS l
JOIN DEMO_WAREHOUSE.CORE.COMPANIES b ON l.SUB_BU_ID = b.BU_ID
JOIN DEMO_WAREHOUSE.CORE.COMPANIES invoice_org ON b.BU_SEND_BILLS_TO = invoice_org.BU_ID
LEFT JOIN DEMO_WAREHOUSE.CORE.COMPANIES invoice_parent ON invoice_org.bu_subsidiary_of = invoice_parent.bu_id
LEFT JOIN DEMO_WAREHOUSE.CORE.COMPANIES parent_org ON b.bu_subsidiary_of = parent_org.bu_id
JOIN DEMO_WAREHOUSE.CORE.SERVICE_STATUS st ON st.status_id = l.line_status
JOIN DEMO_WAREHOUSE.CORE.PRICE_RULES pc ON pc.prod_id = l.line_prod_id
JOIN DEMO_WAREHOUSE.CORE.PRODUCTS p ON p.product_id = pc.prod_product_id
LEFT JOIN DEMO_WAREHOUSE.CORE.CATEGORY_LINKS cm ON (cm.ctymem_member_id = pc.prod_id AND cm.ctymem_cty_id = 1071)
LEFT JOIN DEMO_WAREHOUSE.CORE.CATEGORY_LINKS cm2 ON (cm2.ctymem_member_id = l.line_id AND cm2.ctymem_ctyt_id = 3012)
LEFT JOIN DEMO_WAREHOUSE.CORE.CATEGORY_LINKS cm3 ON (cm3.ctymem_member_id = pc.prod_id AND cm3.ctymem_ctyt_id = 1421)
LEFT JOIN DEMO_WAREHOUSE.CORE.CATEGORY_LINKS cm4 ON (cm4.ctymem_member_id = l.line_id AND cm2.ctymem_ctyt_id = 3031)
LEFT JOIN DEMO_WAREHOUSE.CORE.CATEGORIES tech ON cm3.ctymem_cty_id = tech.cty_id
LEFT JOIN (
  SELECT MAX(inv_date) AS prev_invoice_date,
         MAX(inv_due_date) AS prev_invoice_due_date, invli_line_id
  FROM DEMO_WAREHOUSE.CORE.INVOICES i
  LEFT JOIN DEMO_WAREHOUSE.CORE.INVOICE_ITEMS il ON i.inv_id = il.invli_invoice_id
  GROUP BY invli_line_id
) inv_tmp ON l.line_id = inv_tmp.invli_line_id
LEFT JOIN DEMO_WAREHOUSE.CORE.CIRCUIT_LABELS samband
  ON (l.line_conn_id = samband.eci_conn_id AND
      (samband.eci_to_date::string::date >= current_date() OR samband.eci_to_date IS NULL))
LEFT JOIN DEMO_WAREHOUSE.CORE.PEOPLE inv_sales_rep ON invoice_org.bu_sales_rep = inv_sales_rep.emp_id
LEFT JOIN DEMO_WAREHOUSE.CORE.PEOPLE sales_rep ON b.bu_sales_rep = sales_rep.emp_id
LEFT JOIN DEMO_WAREHOUSE.CORE.PEOPLE inv_cust_contact ON invoice_org.bu_our_customer_contact = inv_cust_contact.emp_id
LEFT JOIN DEMO_WAREHOUSE.CORE.PEOPLE cust_contact ON b.bu_our_customer_contact = cust_contact.emp_id
LEFT JOIN (
  SELECT SUM(CASE WHEN pcc.prod_price_duration_unit LIKE 'month' THEN ll.line_periodic_amount
                  WHEN pcc.prod_price_duration_unit LIKE 'quarter' THEN ll.line_periodic_amount / 3
                  WHEN pcc.prod_price_duration_unit LIKE 'year' THEN ll.line_periodic_amount / 12
                  ELSE 0 END) AS connection_mrc, ll.line_conn_id
  FROM DEMO_WAREHOUSE.REPORTS.SERVICE_CONTRACTS ll
  JOIN DEMO_WAREHOUSE.CORE.PRICE_RULES pcc ON pcc.prod_id = ll.line_prod_id
  JOIN DEMO_WAREHOUSE.CORE.SERVICE_STATUS st ON ll.line_status = status_id
  WHERE st.status_category <> 'Under Deactivation'
  GROUP BY ll.line_conn_id
) conn_mrc ON l.line_conn_id = conn_mrc.line_conn_id
LEFT JOIN DEMO_WAREHOUSE.CORE.CHARGE_KINDS cht ON cht.cht_id = pc.PROD_CHT_ID
LEFT JOIN DEMO_WAREHOUSE.REFERENCE.COMPANY_DIRECTORY c1
  ON regexp_replace(b.BU_COMPANY_NUMBER, '[^0-9]', '') = c1.VAT_NUMBER::string
  AND c1.COUNTRY_CODE = 'NO' AND c1.IS_DELETED = 0
LEFT JOIN DEMO_WAREHOUSE.REFERENCE.COMPANY_DIRECTORY c2
  ON regexp_replace(invoice_org.BU_COMPANY_NUMBER, '[^0-9]', '') = c2.VAT_NUMBER::string
  AND c2.COUNTRY_CODE = 'NO' AND c2.IS_DELETED = 0
LEFT JOIN DEMO_WAREHOUSE.REFERENCE.COMPANY_DIRECTORY c3
  ON regexp_replace(parent_org.BU_COMPANY_NUMBER, '[^0-9]', '') = c3.VAT_NUMBER::string
  AND c3.COUNTRY_CODE = 'NO' AND c3.IS_DELETED = 0
WHERE st.STATUS_CANCELLED = 0
  AND ((l.STATUS_INVOICEABLE = 1) OR
       (l.STATUS_TERMINATED = 0 AND l.STATUS_INVOICEABLE = 0
        AND l.STATUS_MAIN_CATEGORY = 'Booking' AND l.LINE_START_DATE::string::date > current_date())
       AND (cht.CHT_ROLE = 'Periodic' OR (cht.CHT_ROLE = 'Once' AND l.LINE_LAST_INVOICE_DATE IS NULL)))
  AND st.status_category <> 'Under Deactivation'
  AND (substr(sales_rep.EMP_SEGMENT, 1, 6) LIKE 'Public'
       OR substr(sales_rep.EMP_SEGMENT, 1, 10) LIKE 'Enterprise');
