/*
 * Copyright (c) The Libre Solar Project Contributors
 *
 * SPDX-License-Identifier: Apache-2.0
 */

#include "tests.h"

#include "ext/can_msg.h"

/* Values below are what is on the bus; they must not change with the Zephyr version. */

static void reqresp_ids_carry_node_address()
{
    TEST_ASSERT_EQUAL_HEX32(0x18001400, can_msg_reqresp_rx_id(0x14));
    TEST_ASSERT_EQUAL_HEX32(0x18000014, can_msg_reqresp_tx_id(0x14));
    TEST_ASSERT_EQUAL_HEX32(0x1800FD00, can_msg_reqresp_rx_id(0xFD));
    TEST_ASSERT_EQUAL_HEX32(0x180000FD, can_msg_reqresp_tx_id(0xFD));
}

static void isotp_uses_extended_ids_with_fixed_addressing()
{
    struct isotp_msg_id addr = can_msg_isotp_addr(can_msg_reqresp_rx_id(0x14));

    TEST_ASSERT_EQUAL_HEX32(0x18001400, addr.ext_id);
    TEST_ASSERT_EQUAL_HEX8(ISOTP_MSG_FIXED_ADDR | ISOTP_MSG_IDE, addr.flags);
    TEST_ASSERT_EQUAL(0, addr.flags & (ISOTP_MSG_EXT_ADDR | ISOTP_MSG_FDF | ISOTP_MSG_BRS));
    TEST_ASSERT_EQUAL(0, addr.ext_addr);
}

static void pubsub_filter_matches_on_message_type_only()
{
    struct can_filter filter = can_msg_pubsub_filter();

    TEST_ASSERT_EQUAL_HEX32(0x02000000, filter.id);
    TEST_ASSERT_EQUAL_HEX32(0x03000000, filter.mask);
    TEST_ASSERT_EQUAL_HEX8(CAN_FILTER_IDE, filter.flags);
}

static void pubsub_filter_accepts_publications_of_any_node()
{
    struct can_filter filter = can_msg_pubsub_filter();
    struct can_frame frame = { 0 };
    frame.flags = CAN_FRAME_IDE;

    frame.id = TS_CAN_TYPE_PUBSUB | TS_CAN_PRIO_PUBSUB_LOW | TS_CAN_DATA_ID_SET(0x7001) | 0x0A;
    TEST_ASSERT_TRUE(can_frame_matches_filter(&frame, &filter));

    frame.id = TS_CAN_TYPE_PUBSUB | TS_CAN_PRIO_CONTROL_HIGH | TS_CAN_DATA_ID_SET(0x8001) | 0xFD;
    TEST_ASSERT_TRUE(can_frame_matches_filter(&frame, &filter));
}

static void pubsub_filter_rejects_other_frames()
{
    struct can_filter filter = can_msg_pubsub_filter();
    struct can_frame frame = { 0 };

    // request/response and network management messages
    frame.flags = CAN_FRAME_IDE;
    frame.id = can_msg_reqresp_rx_id(0x14);
    TEST_ASSERT_FALSE(can_frame_matches_filter(&frame, &filter));
    frame.id = TS_CAN_TYPE_NETWORK | TS_CAN_PRIO_NETWORK_MGMT | 0x0A;
    TEST_ASSERT_FALSE(can_frame_matches_filter(&frame, &filter));

    // standard (11-bit) identifier
    frame.flags = 0;
    frame.id = 0x200;
    TEST_ASSERT_FALSE(can_frame_matches_filter(&frame, &filter));
}

static void pub_frame_is_extended_data_frame()
{
    uint8_t data[8] = { 1, 2, 3, 4, 5, 6, 7, 8 };
    struct can_frame frame = can_msg_pub_frame(0x1E700114, data, 5);

    TEST_ASSERT_EQUAL_HEX32(0x1E700114, frame.id);
    TEST_ASSERT_EQUAL_HEX8(CAN_FRAME_IDE, frame.flags);
    TEST_ASSERT_EQUAL(5, frame.dlc);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(data, frame.data, 5);
    TEST_ASSERT_EQUAL(0, frame.data[5]);

    frame = can_msg_pub_frame(0x1E700114, data, 0);
    TEST_ASSERT_EQUAL(0, frame.dlc);
    TEST_ASSERT_EQUAL_HEX8(CAN_FRAME_IDE, frame.flags);
}

static void pub_frame_is_limited_to_classic_payload()
{
    uint8_t data[12] = { 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12 };
    struct can_frame frame = can_msg_pub_frame(0x1E700114, data, sizeof(data));

    TEST_ASSERT_EQUAL(8, frame.dlc);
    TEST_ASSERT_EQUAL_HEX8_ARRAY(data, frame.data, 8);
}

static struct can_frame frame_with_id(uint32_t id, uint8_t flags = CAN_FRAME_IDE)
{
    struct can_frame frame = { 0 };
    frame.id = id;
    frame.flags = flags;
    return frame;
}

static bool is_control(uint32_t id, uint16_t node_addr)
{
    struct can_frame frame = frame_with_id(id);
    return can_msg_is_control(&frame, node_addr);
}

static void control_messages_only_from_lower_addresses()
{
    uint32_t ctrl = TS_CAN_TYPE_PUBSUB | TS_CAN_PRIO_CONTROL_HIGH | TS_CAN_DATA_ID_SET(0x8001);
    uint32_t pub = TS_CAN_TYPE_PUBSUB | TS_CAN_PRIO_PUBSUB_LOW | TS_CAN_DATA_ID_SET(0x7001);

    TEST_ASSERT_TRUE(is_control(ctrl | 0x0A, 0x14));
    TEST_ASSERT_FALSE(is_control(ctrl | 0x14, 0x14));
    TEST_ASSERT_FALSE(is_control(ctrl | 0x15, 0x14));
    TEST_ASSERT_FALSE(is_control(pub | 0x0A, 0x14));
    // 0x8000 itself is not a control data object
    TEST_ASSERT_FALSE(is_control(TS_CAN_TYPE_PUBSUB | TS_CAN_DATA_ID_SET(0x8000) | 0x0A, 0x14));
    // node addresses are stored as 16 bit and not truncated for the comparison
    TEST_ASSERT_TRUE(is_control(ctrl | 0xFD, 0x100));
}

static void remote_requests_are_not_control_messages()
{
    uint32_t ctrl = TS_CAN_TYPE_PUBSUB | TS_CAN_PRIO_CONTROL_HIGH | TS_CAN_DATA_ID_SET(0x8001);
    struct can_frame rtr = frame_with_id(ctrl | 0x0A, CAN_FRAME_IDE | CAN_FRAME_RTR);

    TEST_ASSERT_FALSE(can_msg_is_control(&rtr, 0x14));
}

int can_tests()
{
    UNITY_BEGIN();

    RUN_TEST(reqresp_ids_carry_node_address);
    RUN_TEST(isotp_uses_extended_ids_with_fixed_addressing);
    RUN_TEST(pubsub_filter_matches_on_message_type_only);
    RUN_TEST(pubsub_filter_accepts_publications_of_any_node);
    RUN_TEST(pubsub_filter_rejects_other_frames);
    RUN_TEST(pub_frame_is_extended_data_frame);
    RUN_TEST(pub_frame_is_limited_to_classic_payload);
    RUN_TEST(control_messages_only_from_lower_addresses);
    RUN_TEST(remote_requests_are_not_control_messages);

    return UNITY_END();
}
