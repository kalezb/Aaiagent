package com.aaiagent.data.db.entity

import androidx.room.ColumnInfo
import androidx.room.Entity
import androidx.room.PrimaryKey

@Entity(tableName = "user_location")
data class UserLocationEntity(
    @PrimaryKey val id: Int = 1,
    @ColumnInfo(name = "home_city") val homeCity: String = "重庆",
    @ColumnInfo(name = "home_district") val homeDistrict: String = "两江新区",
    @ColumnInfo(name = "work_city") val workCity: String = "重庆",
    @ColumnInfo(name = "work_district") val workDistrict: String = "两江新区"
)
