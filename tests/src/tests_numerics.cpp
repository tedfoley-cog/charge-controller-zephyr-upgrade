/*
 * Copyright (c) The Libre Solar Project Contributors
 *
 * SPDX-License-Identifier: Apache-2.0
 */

/*
 * Characterization tests for the control maths that was moved from double to single precision
 * (NTC temperature, ADC scaling, charger thresholds, DC/DC and half bridge limits).
 *
 * Expected values are derived from the formulas with a margin that is far above the float
 * rounding error, so the tests pass with double and with single precision maths.
 */

#include "tests.h"

#include <stdint.h>

#include "daq.h"
#include "daq_stub.h"
#include "half_bridge.h"
#include "setup.h"

extern volatile uint16_t adc_readings[NUM_ADC_CH];

static const AdcValues adc_defaults = {
    .solar_voltage = 30,
    .battery_voltage = 12,
    .dcdc_current = 3,
    .load_current = 1,
    .bat_temperature = 25,
    .internal_temperature = 25,
};

static void daq_update_with(AdcValues values)
{
    prepare_adc_readings(values);
    prepare_adc_filtered();
    daq_update();
}

/*
 * NTC temperature (beta equation, 10k series resistor, 3.3 V reference in unit tests)
 */

static float ntc_temp_for_raw(uint16_t raw)
{
    prepare_adc_readings(adc_defaults);
    adc_readings[ADC_POS(temp_fets)] = raw;
    prepare_adc_filtered();
    daq_update();
    return dcdc.temp_mosfets;
}

void ntc_temp_nominal_resistance_is_25_degc()
{
    // half of full scale: NTC equals series resistor (10k)
    TEST_ASSERT_FLOAT_WITHIN(0.05F, 25.0F, ntc_temp_for_raw(32768));
}

void ntc_temp_hot()
{
    // quarter of full scale: NTC resistance 3.33k
    TEST_ASSERT_FLOAT_WITHIN(0.05F, 56.43F, ntc_temp_for_raw(16384));
}

void ntc_temp_cold()
{
    // three quarters of full scale: NTC resistance 30k
    TEST_ASSERT_FLOAT_WITHIN(0.05F, -0.96F, ntc_temp_for_raw(49152));
}

void ntc_temp_is_monotonic()
{
    float previous = ntc_temp_for_raw(4096);
    for (uint32_t raw = 8192; raw < 65536; raw += 4096) {
        float temp = ntc_temp_for_raw(raw);
        TEST_ASSERT_TRUE(temp < previous);
        previous = temp;
    }
}

/*
 * ADC scaling
 */

void adc_stub_raw_readings_unchanged()
{
    AdcValues values = adc_defaults;
    values.solar_voltage = 44.4F;
    values.battery_voltage = 14.4F;
    values.dcdc_current = 7.3F;
    values.load_current = 2.6F;
    prepare_adc_readings(values);

    // left-aligned 12-bit readings for a 3.3 V reference
    TEST_ASSERT_EQUAL_UINT16(1519 << 4, adc_readings[ADC_POS(vref_mcu)]);
    TEST_ASSERT_EQUAL_UINT16(1186 << 4, adc_readings[ADC_POS(v_high)]);
    TEST_ASSERT_EQUAL_UINT16(947 << 4, adc_readings[ADC_POS(v_low)]);
    TEST_ASSERT_EQUAL_UINT16(453 << 4, adc_readings[ADC_POS(i_dcdc)]);
    TEST_ASSERT_EQUAL_UINT16(161 << 4, adc_readings[ADC_POS(i_load)]);
}

void adc_scaling_bus_voltages()
{
    AdcValues values = adc_defaults;
    values.solar_voltage = 44.4F;
    values.battery_voltage = 14.4F;
    daq_update_with(values);

    // one 12-bit LSB is 15 mV on the low side and 37 mV on the high side
    TEST_ASSERT_FLOAT_WITHIN(0.02F, 14.4F, lv_bus.voltage);
    TEST_ASSERT_FLOAT_WITHIN(0.04F, 44.4F, hv_bus.voltage);
}

void adc_scaling_currents()
{
    AdcValues values = adc_defaults;
    values.dcdc_current = 0;
    values.load_current = 0;
    daq_update_with(values);
    calibrate_current_sensors();

    values.dcdc_current = 7.3F;
    values.load_current = 2.6F;
    daq_update_with(values);

    // one 12-bit LSB is 16 mA
    TEST_ASSERT_FLOAT_WITHIN(0.02F, 7.3F, dcdc.inductor_current);
    TEST_ASSERT_FLOAT_WITHIN(0.02F, 2.6F, load.current);
    TEST_ASSERT_FLOAT_WITHIN(0.5F, 7.3F * 14.4F / 14.4F * lv_bus.voltage, dcdc.power);
}

void adc_raw_voltage_round_trip()
{
    for (int32_t raw = 0; raw <= 65535; raw += 4369) {
        float voltage = adc_raw_to_voltage(raw, 3300);
        TEST_ASSERT_FLOAT_WITHIN(1e-4F, raw * 3.3F / 65536.0F, voltage);
        TEST_ASSERT_INT32_WITHIN(1, raw, adc_voltage_to_raw(voltage, 3300));
    }
}

void adc_raw_clamp_limits()
{
    TEST_ASSERT_EQUAL_UINT16(0, adc_raw_clamp(1000.0F, 0.0F));
    TEST_ASSERT_EQUAL_UINT16(14400, adc_raw_clamp(1000.0F, 14.4F));
    TEST_ASSERT_EQUAL_UINT16(UINT16_MAX, adc_raw_clamp(1000.0F, 80.0F));
}

/*
 * Charger thresholds (battery configuration plausibility and SOC estimation)
 */

static void init_bat_conf()
{
    battery_conf_init(&bat_conf, BAT_TYPE_FLOODED, 6, 100);
    bat_conf.wire_resistance = 0; // not touched by battery_conf_init
}

void bat_conf_defaults_are_plausible()
{
    bat_conf.wire_resistance = 0;
    const int types[] = { BAT_TYPE_FLOODED, BAT_TYPE_GEL, BAT_TYPE_AGM };
    for (int type : types) {
        battery_conf_init(&bat_conf, type, 6, 100);
        TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    }
}

void bat_conf_load_reconnect_hysteresis()
{
    init_bat_conf();
    bat_conf.load_reconnect_voltage = bat_conf.load_disconnect_voltage + 0.5F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.load_reconnect_voltage = bat_conf.load_disconnect_voltage + 0.3F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_recharge_below_topping()
{
    init_bat_conf();
    bat_conf.recharge_voltage = bat_conf.topping_voltage - 0.5F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.recharge_voltage = bat_conf.topping_voltage - 0.3F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_load_disconnect_above_absolute_min()
{
    init_bat_conf();
    bat_conf.absolute_min_voltage = bat_conf.load_disconnect_voltage - 0.5F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.absolute_min_voltage = bat_conf.load_disconnect_voltage - 0.3F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_internal_resistance_limit()
{
    init_bat_conf();
    // limit: 10% voltage drop at max discharge current (20 A in unit tests)
    float limit = bat_conf.load_disconnect_voltage * 0.1F / 20.0F;
    bat_conf.internal_resistance = limit * 0.95F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.internal_resistance = limit * 1.05F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_wire_resistance_limit()
{
    init_bat_conf();
    // limit: 3% voltage drop at max discharge current (20 A in unit tests)
    float limit = bat_conf.topping_voltage * 0.03F / 20.0F;
    bat_conf.wire_resistance = limit * 0.95F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.wire_resistance = limit * 1.05F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_topping_cutoff_current_limits()
{
    init_bat_conf();
    bat_conf.topping_cutoff_current = 9.5F; // just below C/10
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.topping_cutoff_current = 10.5F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
    bat_conf.topping_cutoff_current = 0.02F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    bat_conf.topping_cutoff_current = 0.005F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

/*
 * Profiles stored in the field that sit exactly on a threshold: battery_conf_check must keep the
 * outcome it had on Zephyr v3.2 (double-precision comparison), otherwise the stored profile is
 * replaced by defaults at boot. Each accepted case below is rejected by a float-only comparison
 * and each "v3.2 rejected" case must stay rejected.
 */

void bat_conf_stored_lfp_cutoff_at_c10_kept()
{
    bat_conf.wire_resistance = 0;

    // LFP defaults: cutoff = C/10 in float. 0.7F and 0.9F are below 0.7 and 0.9
    battery_conf_init(&bat_conf, BAT_TYPE_LFP, 4, 7);
    TEST_ASSERT_EQUAL_FLOAT(0.7F, bat_conf.topping_cutoff_current);
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
    battery_conf_init(&bat_conf, BAT_TYPE_LFP, 4, 9);
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));

    // not loosened: 0.3F is above 0.3, 10.0F equals 10.0
    battery_conf_init(&bat_conf, BAT_TYPE_LFP, 4, 3);
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
    battery_conf_init(&bat_conf, BAT_TYPE_LFP, 4, 100);
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_stored_internal_resistance_at_limit()
{
    // limit: 10% drop at 20 A
    init_bat_conf();
    bat_conf.load_disconnect_voltage = 11.0F;
    bat_conf.internal_resistance = 0.055F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));

    // v3.2 rejected this one (a float-only comparison would accept it)
    init_bat_conf();
    bat_conf.load_disconnect_voltage = 10.7F;
    bat_conf.internal_resistance = 0.0535F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

void bat_conf_stored_wire_resistance_at_limit()
{
    // limit: 3% drop at 20 A
    init_bat_conf();
    bat_conf.topping_voltage = 14.0F;
    bat_conf.float_voltage = 13.8F; // keep below topping voltage
    bat_conf.wire_resistance = 0.021F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));
}

void bat_conf_stored_voltage_margins_at_limit()
{
    // exactly 0.4 V apart in decimal: rejected on v3.2
    init_bat_conf();
    bat_conf.load_disconnect_voltage = 11.0F;
    bat_conf.load_reconnect_voltage = 11.4F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));

    init_bat_conf();
    bat_conf.topping_voltage = 14.0F;
    bat_conf.float_voltage = 13.8F; // keep below topping voltage
    bat_conf.recharge_voltage = 13.6F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));

    init_bat_conf();
    bat_conf.absolute_min_voltage = 11.0F;
    bat_conf.load_disconnect_voltage = 11.4F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));

    // Low-voltage profiles where the float sum rounds onto the stored value: accepted on v3.2,
    // rejected by a float-only comparison (3.4F is above 3.0 + 0.4, 2.6F is below 3.0 - 0.4)
    init_bat_conf();
    bat_conf.absolute_min_voltage = 2.0F;
    bat_conf.internal_resistance = 0.01F;
    bat_conf.load_disconnect_voltage = 3.0F;
    bat_conf.load_reconnect_voltage = 3.4F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));

    init_bat_conf();
    bat_conf.absolute_min_voltage = 0.5F;
    bat_conf.internal_resistance = 0.004F;
    bat_conf.load_disconnect_voltage = 1.0F;
    bat_conf.load_reconnect_voltage = 2.0F;
    bat_conf.float_voltage = 2.9F;
    bat_conf.topping_voltage = 3.0F;
    bat_conf.recharge_voltage = 2.6F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));

    init_bat_conf();
    bat_conf.internal_resistance = 0.01F;
    bat_conf.absolute_min_voltage = 3.0F;
    bat_conf.load_disconnect_voltage = 3.4F;
    TEST_ASSERT_TRUE(battery_conf_check(&bat_conf));

    // lowest accepted cutoff current: 0.01F is below 0.01
    init_bat_conf();
    bat_conf.topping_cutoff_current = 0.01F;
    TEST_ASSERT_FALSE(battery_conf_check(&bat_conf));
}

static void init_soc(float bus_voltage, float current)
{
    init_bat_conf();
    charger.port = &bat_terminal;
    charger.init_terminal(&bat_conf);
    bat_terminal.bus->voltage = bus_voltage;
    bat_terminal.current = current;
}

void soc_follows_open_circuit_voltage()
{
    init_bat_conf();
    // 50.5 % between empty and full open circuit voltage
    init_soc(bat_conf.ocv_empty + 0.505F * (bat_conf.ocv_full - bat_conf.ocv_empty), 0.1F);

    // SOC is low-pass filtered and settles within 1 % of the target
    for (int i = 0; i < 2000; i++) {
        charger.update_soc(&bat_conf);
    }
    TEST_ASSERT_UINT16_WITHIN(1, 50, charger.soc);
}

void soc_not_updated_under_load()
{
    init_bat_conf();
    init_soc(bat_conf.ocv_empty + 0.505F * (bat_conf.ocv_full - bat_conf.ocv_empty), 0.1F);
    for (int i = 0; i < 2000; i++) {
        charger.update_soc(&bat_conf);
    }
    uint16_t soc = charger.soc;

    // more than 0.2 A in either direction: open circuit voltage is not valid
    init_soc(bat_conf.ocv_empty, 0.3F);
    for (int i = 0; i < 2000; i++) {
        charger.update_soc(&bat_conf);
    }
    TEST_ASSERT_EQUAL_UINT16(soc, charger.soc);

    init_soc(bat_conf.ocv_empty, -0.3F);
    for (int i = 0; i < 2000; i++) {
        charger.update_soc(&bat_conf);
    }
    TEST_ASSERT_EQUAL_UINT16(soc, charger.soc);
}

void soc_discharged_ah_integration()
{
    init_soc(12.0F, -3.6F);
    charger.discharged_Ah = 0;
    for (int i = 0; i < 1000; i++) {
        charger.update_soc(&bat_conf); // called once per second
    }
    TEST_ASSERT_FLOAT_WITHIN(0.001F, 1.0F, charger.discharged_Ah);
}

/*
 * DC/DC and half bridge limits
 */

static void init_dcdc_buck(float hv_voltage, float lv_voltage)
{
    dev_stat.error_flags = 0;
    half_bridge_stop();

    hv_terminal.init_solar();
    hv_terminal.bus->voltage = hv_voltage;
    hv_terminal.bus->src_voltage_intercept = lv_voltage + 1;
    hv_terminal.bus->series_multiplier = 1;
    hv_terminal.current = 0;
    hv_terminal.update_bus_current_margins();

    battery_conf_init(&bat_conf, BAT_TYPE_GEL, 6, 100);
    charger.port = &lv_terminal;
    charger.init_terminal(&bat_conf);
    lv_terminal.bus->voltage = lv_voltage;
    lv_terminal.bus->series_multiplier = 1;
    lv_terminal.current = 0;
    lv_terminal.update_bus_current_margins();

    dcdc.mode = DCDC_MODE_BUCK;
    dcdc.enable = true;
    dcdc.off_timestamp = -10000;
    dcdc.inductor_current = 0;
    dcdc.power = 0;
}

void dcdc_buck_needs_15_percent_voltage_headroom()
{
    // low side must be below 85% of the high side: 12 V / 0.85 = 14.1 V
    init_dcdc_buck(14.5F, 12.0F);
    TEST_ASSERT_EQUAL(DCDC_MODE_BUCK, dcdc.check_start_conditions());

    init_dcdc_buck(13.8F, 12.0F);
    TEST_ASSERT_EQUAL(DCDC_MODE_OFF, dcdc.check_start_conditions());
}

void dcdc_low_side_minimum_voltage()
{
    TEST_ASSERT_EQUAL_FLOAT(9.0F, dcdc.ls_voltage_min);

    init_dcdc_buck(20.0F, 9.2F);
    TEST_ASSERT_EQUAL(DCDC_MODE_BUCK, dcdc.check_start_conditions());

    init_dcdc_buck(20.0F, 8.8F);
    TEST_ASSERT_EQUAL(DCDC_MODE_OFF, dcdc.check_start_conditions());
}

void half_bridge_duty_cycle_range()
{
    half_bridge_init(70, 300, 0.0F, 1.0F);
    half_bridge_stop();

    half_bridge_set_duty_cycle(0.5F);
    uint16_t ccr = half_bridge_get_ccr();
    TEST_ASSERT_FLOAT_WITHIN(0.006F, 0.5F, half_bridge_get_duty_cycle());

    // values outside of 0..1 are ignored
    half_bridge_set_duty_cycle(-0.1F);
    TEST_ASSERT_EQUAL_UINT16(ccr, half_bridge_get_ccr());
    half_bridge_set_duty_cycle(1.1F);
    TEST_ASSERT_EQUAL_UINT16(ccr, half_bridge_get_ccr());

    // the limits themselves are accepted
    half_bridge_set_duty_cycle(0.0F);
    TEST_ASSERT_EQUAL_UINT16(0, half_bridge_get_ccr());
    half_bridge_set_duty_cycle(1.0F);
    TEST_ASSERT_EQUAL_UINT16(half_bridge_get_arr(), half_bridge_get_ccr());
}

void nanogrid_port_defaults()
{
    DcBus bus = {};
    PowerPort port(&bus);
    port.init_nanogrid();

    TEST_ASSERT_EQUAL_FLOAT(5.0F, port.pos_current_limit);
    TEST_ASSERT_EQUAL_FLOAT(-5.0F, port.neg_current_limit);
    TEST_ASSERT_EQUAL_FLOAT(0.1F, bus.sink_droop_res);
    TEST_ASSERT_EQUAL_FLOAT(0.1F, bus.src_droop_res);
    TEST_ASSERT_EQUAL_FLOAT(30.0F, bus.src_voltage_intercept);
    TEST_ASSERT_EQUAL_FLOAT(28.0F, bus.sink_voltage_intercept);
}

int numerics_tests()
{
    UNITY_BEGIN();

    RUN_TEST(ntc_temp_nominal_resistance_is_25_degc);
    RUN_TEST(ntc_temp_hot);
    RUN_TEST(ntc_temp_cold);
    RUN_TEST(ntc_temp_is_monotonic);

    RUN_TEST(adc_stub_raw_readings_unchanged);
    RUN_TEST(adc_scaling_bus_voltages);
    RUN_TEST(adc_scaling_currents);
    RUN_TEST(adc_raw_voltage_round_trip);
    RUN_TEST(adc_raw_clamp_limits);

    RUN_TEST(bat_conf_defaults_are_plausible);
    RUN_TEST(bat_conf_load_reconnect_hysteresis);
    RUN_TEST(bat_conf_recharge_below_topping);
    RUN_TEST(bat_conf_load_disconnect_above_absolute_min);
    RUN_TEST(bat_conf_internal_resistance_limit);
    RUN_TEST(bat_conf_wire_resistance_limit);
    RUN_TEST(bat_conf_topping_cutoff_current_limits);
    RUN_TEST(bat_conf_stored_lfp_cutoff_at_c10_kept);
    RUN_TEST(bat_conf_stored_internal_resistance_at_limit);
    RUN_TEST(bat_conf_stored_wire_resistance_at_limit);
    RUN_TEST(bat_conf_stored_voltage_margins_at_limit);
    RUN_TEST(soc_follows_open_circuit_voltage);
    RUN_TEST(soc_not_updated_under_load);
    RUN_TEST(soc_discharged_ah_integration);

    RUN_TEST(dcdc_buck_needs_15_percent_voltage_headroom);
    RUN_TEST(dcdc_low_side_minimum_voltage);
    RUN_TEST(half_bridge_duty_cycle_range);
    RUN_TEST(nanogrid_port_defaults);

    return UNITY_END();
}
