-- create database if not exists orbiter_data default character set UTF8mb4 collate utf8mb4_unicode_ci;
-- USE orbiter_data;
SET NAMES utf8mb4;
SET FOREIGN_KEY_CHECKS = 0;
-- ----------------------------
-- Table structure for maker_transaction
-- ----------------------------
DROP TABLE IF EXISTS `maker_transaction`;
CREATE TABLE `maker_transaction` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `transcationId` varchar(100) DEFAULT NULL COMMENT 'transcationId',
  `inId` int(11) DEFAULT NULL COMMENT 'inId',
  `outId` int(11) DEFAULT NULL COMMENT 'outId',
  `fromChain` int(11) DEFAULT NULL COMMENT 'from Chain',
  `toChain` int(11) DEFAULT NULL COMMENT 'to Chain',
  `toAmount` varchar(255) DEFAULT NULL COMMENT 'toAmount',
  `replySender` varchar(255) DEFAULT NULL COMMENT 'maker Sender Address',
  `replyAccount` varchar(255) DEFAULT NULL COMMENT 'reply user Recipient',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`),
  UNIQUE KEY `trxid` (`transcationId`) USING BTREE,
  UNIQUE KEY `maker_transaction_ibfk_1` (`inId`) USING BTREE,
  UNIQUE KEY `maker_transaction_ibfk_2` (`outId`) USING BTREE,
  KEY `replySender` (`replySender`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1998278 DEFAULT CHARSET=utf8;

-- ----------------------------
-- Table structure for transaction
-- ----------------------------
DROP TABLE IF EXISTS `transaction`;
CREATE TABLE `transaction` (
  `id` int(11) NOT NULL AUTO_INCREMENT COMMENT 'ID',
  `hash` varchar(255) NOT NULL COMMENT 'Hash',
  `nonce` bigint(20) NOT NULL COMMENT 'Nonce',
  `blockHash` varchar(255) DEFAULT NULL COMMENT 'blockHash',
  `blockNumber` bigint(20) DEFAULT NULL COMMENT 'blockNumber',
  `transactionIndex` int(11) DEFAULT NULL COMMENT 'transactionIndex',
  `from` varchar(255) NOT NULL COMMENT 'from',
  `to` varchar(255) NOT NULL COMMENT 'to',
  `value` varchar(32) NOT NULL COMMENT 'value',
  `symbol` varchar(20) NOT NULL COMMENT 'symbol',
  `gasPrice` bigint(20) DEFAULT NULL COMMENT 'gasPrice',
  `gas` bigint(20) DEFAULT NULL COMMENT 'gas',
  `input` text COMMENT 'input',
  `status` tinyint(1) NOT NULL COMMENT 'status:0=PENDING,1=COMPLETE,2=REJECT,3=MatchFailed,4=refund,99= MatchSuccess,98=makerDelayTransfer',
  `tokenAddress` varchar(255) NOT NULL COMMENT 'tokenAddress',
  `timestamp` datetime NOT NULL COMMENT 'timestamp',
  `side` tinyint(1) DEFAULT NULL COMMENT 'side:0=user,1=maker',
  `fee` varchar(20) DEFAULT NULL COMMENT 'fee',
  `feeToken` varchar(20) DEFAULT NULL COMMENT 'feeToken',
  `chainId` int(11) NOT NULL COMMENT 'chainId',
  `source` varchar(20) DEFAULT NULL COMMENT 'source',
  `memo` varchar(50) DEFAULT NULL COMMENT 'memo',
  `extra` json DEFAULT NULL COMMENT 'extra',
  `replyAccount` varchar(255) DEFAULT NULL COMMENT 'replyUser',
  `replySender` varchar(255) DEFAULT NULL COMMENT 'replyMaker',
  `createdAt` datetime NOT NULL,
  `updatedAt` datetime NOT NULL,
  PRIMARY KEY (`id`,`timestamp`) USING BTREE,
  KEY `symbol` (`replySender`,`chainId`,`symbol`) USING BTREE
) ENGINE=InnoDB AUTO_INCREMENT=1091205 DEFAULT CHARSET=utf8;

-- ----------------------------
-- View structure for data_size
-- ----------------------------
DROP VIEW IF EXISTS `data_size`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `data_size` AS select concat(round(sum(((`information_schema`.`tables`.`DATA_LENGTH` / 1024) / 1024)),2),'M') AS `dataSize`,concat(round(sum(((`information_schema`.`tables`.`INDEX_LENGTH` / 1024) / 1024)),2),'M') AS `indexSize` from `information_schema`.`tables` where (`information_schema`.`tables`.`TABLE_SCHEMA` = 'orbiterTransaction');

-- ----------------------------
-- View structure for day_trx_statistics
-- ----------------------------
DROP VIEW IF EXISTS `day_trx_statistics`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `day_trx_statistics` AS select count(1) AS `count(1)`,date_format(`t`.`timestamp`,'%Y-%m-%d') AS `ym` from `transaction` `t` where ((`t`.`chainId` = 3) and ((`t`.`from` = '0x80C67432656d59144cEFf962E8fAF8926599bCF8') or (`t`.`to` = '0x80C67432656d59144cEFf962E8fAF8926599bCF8')) and (`t`.`timestamp` >= '2022-06-01 00:00')) group by `ym` order by `ym`;

-- ----------------------------
-- View structure for groupchain_trx_statistics
-- ----------------------------
DROP VIEW IF EXISTS `groupchain_trx_statistics`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `groupchain_trx_statistics` AS select `transaction`.`chainId` AS `chainId`,count(1) AS `totalTrx` from `transaction` group by `transaction`.`chainId`;

-- ----------------------------
-- View structure for matched_num
-- ----------------------------
DROP VIEW IF EXISTS `matched_num`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `matched_num` AS select count(1) AS `count(1)` from `maker_transaction` where ((`maker_transaction`.`inId` is not null) and (`maker_transaction`.`outId` is not null));

-- ----------------------------
-- View structure for mismatch_num
-- ----------------------------
DROP VIEW IF EXISTS `mismatch_num`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `mismatch_num` AS select sum((case when isnull(`maker_transaction`.`inId`) then 0 else 1 end)) AS `inTotal`,sum((case when isnull(`maker_transaction`.`outId`) then 0 else 1 end)) AS `outTotal`,count(1) AS `total` from `maker_transaction` where (isnull(`maker_transaction`.`inId`) or isnull(`maker_transaction`.`outId`));

-- ----------------------------
-- View structure for month_count
-- ----------------------------
DROP VIEW IF EXISTS `month_count`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `month_count` AS select count(1) AS `trxCount`,date_format(`t`.`timestamp`,'%Y-%m') AS `ym` from `transaction` `t` group by `ym` order by `ym`;

-- ----------------------------
-- View structure for query_match
-- ----------------------------
DROP VIEW IF EXISTS `query_match`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `query_match` AS select `t1`.`hash` AS `fromHash`,`t2`.`hash` AS `toHash`,`t1`.`timestamp` AS `fromTime`,`t2`.`timestamp` AS `toTime`,`mt`.`id` AS `id`,`mt`.`transcationId` AS `transcationId`,`mt`.`inId` AS `inId`,`mt`.`outId` AS `outId`,`mt`.`fromChain` AS `fromChain`,`mt`.`toChain` AS `toChain`,`mt`.`toAmount` AS `toAmount`,`mt`.`replySender` AS `replySender`,`mt`.`replyAccount` AS `replyAccount`,`mt`.`createdAt` AS `createdAt`,`mt`.`updatedAt` AS `updatedAt` from ((`maker_transaction` `mt` join `transaction` `t1` on((`t1`.`id` = `mt`.`inId`))) join `transaction` `t2` on((`t2`.`id` = `mt`.`outId`))) where ((`mt`.`inId` is not null) and (`mt`.`outId` is not null)) order by `t1`.`timestamp` desc;

-- ----------------------------
-- View structure for revenue_statistics
-- ----------------------------
DROP VIEW IF EXISTS `revenue_statistics`;
CREATE ALGORITHM = UNDEFINED SQL SECURITY DEFINER VIEW `revenue_statistics` AS select `inTx`.`timestamp` AS `timestamp`,`inTx`.`value` AS `inValue`,`inTx`.`symbol` AS `inSymbol`,`inTx`.`replySender` AS `replySender`,`inTx`.`replyAccount` AS `replyAccount`,`inTx`.`chainId` AS `fromChain`,`inTx`.`memo` AS `toChain`,`outTx`.`value` AS `outValue`,`outTx`.`symbol` AS `outSymbol`,`outTx`.`fee` AS `outFee`,`outTx`.`feeToken` AS `outFeeToken` from ((`transaction` `inTx` join `maker_transaction` `mt` on((`inTx`.`id` = `mt`.`inId`))) join `transaction` `outTx` on(((`mt`.`outId` = `outTx`.`id`) and (`inTx`.`status` in (99,98)))));

-- ----------------------------
-- Procedure structure for auto_create_partition
-- ----------------------------
DROP PROCEDURE IF EXISTS `auto_create_partition`;
delimiter ;;
CREATE PROCEDURE `auto_create_partition`(IN `table_name` varchar(64))
BEGIN
   SET @next_month:=CONCAT(date_format(date_add(now(),interval 2 month),'%Y%m'),'01');
   SET @SQL = CONCAT( 'ALTER TABLE `', table_name, '`',
     ' ADD PARTITION (PARTITION p', @next_month, " VALUES LESS THAN (TO_DAYS(",
       @next_month ,")) );" );
   PREPARE STMT FROM @SQL;
   EXECUTE STMT;
   DEALLOCATE PREPARE STMT;
END
;;
delimiter ;

-- ----------------------------
-- Procedure structure for sp_add_partitio_transaction
-- ----------------------------
DROP PROCEDURE IF EXISTS `sp_add_partitio_transaction`;
delimiter ;;
CREATE PROCEDURE `sp_add_partitio_transaction`()
BEGIN
	DECLARE i,j INT UNSIGNED DEFAULT 1;
	DECLARE v_tmp_date DATE;
	SET @stmt = '';
	SET @stmt_begin = 'ALTER TABLE transaction PARTITION BY RANGE COLUMNS (timestamp)(';
        SET i = 2021;        
        WHILE i <= 2023 DO
          SET j = 1;
          WHILE j <= 12 DO
            SET v_tmp_date = CONCAT(i,'-01-01');
            SET @stmt = CONCAT(@stmt,'PARTITION p',i,'_',LPAD(j,2,"0"),' VALUES LESS THAN (''',DATE_ADD(v_tmp_date,INTERVAL j MONTH),'''),');
            SET j = j + 1;
          END WHILE;
          SET i = i + 1;
        END WHILE;	
	SET @stmt_end = 'PARTITION p_max VALUES LESS THAN (maxvalue))';
        SET @stmt = CONCAT(@stmt_begin,@stmt,@stmt_end);
        PREPARE s1 FROM @stmt;
        EXECUTE s1;
        DROP PREPARE s1;

        SET @stmt = NULL;
        SET @stmt_begin = NULL;
        SET @stmt_end = NULL;	
	END
;;
delimiter ;
SET FOREIGN_KEY_CHECKS = 1;
