/*
 * Copyright (c) The Libre Solar Project Contributors
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#ifndef CAN_MSG_H_
#define CAN_MSG_H_

/**
 * @file
 *
 * @brief Layout of the ThingSet CAN identifiers, frames and filters used on the bus
 *
 * Kept free of device access so that the bus layout can be unit-tested on the host.
 */

#include <stdint.h>
#include <string.h>

#include <zephyr/canbus/isotp.h>
#include <zephyr/drivers/can.h>

#include "thingset.h"

/** ISO-TP addressing: 29-bit identifiers with SAE J1939 compatible fixed addressing */
/* ThingSet publication frames are classic CAN frames */
#define CAN_MSG_PUB_MAX_LEN 8U

#define CAN_MSG_ISOTP_FLAGS (ISOTP_MSG_FIXED_ADDR | ISOTP_MSG_IDE)

/** Identifier on which request/response (ISO-TP) messages for this node are received */
static inline uint32_t can_msg_reqresp_rx_id(uint8_t node_addr)
{
    return TS_CAN_TYPE_REQRESP | TS_CAN_PRIO_REQRESP | TS_CAN_TARGET_SET(node_addr);
}

/** Identifier with which this node sends request/response (ISO-TP) messages */
static inline uint32_t can_msg_reqresp_tx_id(uint8_t node_addr)
{
    return TS_CAN_TYPE_REQRESP | TS_CAN_PRIO_REQRESP | TS_CAN_SOURCE_SET(node_addr);
}

static inline struct isotp_msg_id can_msg_isotp_addr(uint32_t ext_id)
{
    struct isotp_msg_id addr = { 0 };
    addr.ext_id = ext_id;
    addr.flags = CAN_MSG_ISOTP_FLAGS;
    return addr;
}

/** Filter for the publication messages of all nodes (extended data frames only) */
static inline struct can_filter can_msg_pubsub_filter(void)
{
    struct can_filter filter = { 0 };
    filter.id = TS_CAN_TYPE_PUBSUB;
    filter.mask = TS_CAN_TYPE_MASK;
    filter.flags = CAN_FILTER_IDE;
    return filter;
}

/** Extended data frame for a publication message with up to 8 bytes payload */
static inline struct can_frame can_msg_pub_frame(uint32_t can_id, const uint8_t *data,
                                                 uint8_t data_len)
{
    struct can_frame frame = { 0 };
    frame.id = can_id;
    frame.flags = CAN_FRAME_IDE;
    frame.dlc = data_len > CAN_MSG_PUB_MAX_LEN ? CAN_MSG_PUB_MAX_LEN : data_len;
    memcpy(frame.data, data, frame.dlc);
    return frame;
}

/** Control messages are only accepted from nodes with a lower (higher priority) address */
static inline bool can_msg_is_control(uint32_t can_id, uint16_t node_addr)
{
    return TS_CAN_DATA_ID_GET(can_id) > 0x8000 && TS_CAN_SOURCE_GET(can_id) < node_addr;
}

#endif /* CAN_MSG_H_ */
